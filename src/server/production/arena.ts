import {randomUUID} from 'node:crypto';
import {ARC_MULTICALL_FROM} from '../../shared/arc';
import {createPublicClient,http,keccak256,parseUnits,verifyMessage,type Address,type Hex} from 'viem';
import {arcTestnet} from 'viem/chains';
import {playHand,type DecisionContext,type HandDecision,type PublicTurn} from '../../engine/hand';
import {OpenAICompatibleProvider} from '../provider';
import {buildArcV2Call,factoryV2Abi,requireArcV2Deployment,tournamentV2Abi} from '../circleArc';
import {replayMatches} from '../verification';
import {getCircleUsdcBalance,provisionCircleWallet} from '../wallet';
import {pool,withTx} from './db';
import {chainAgentId,chainTournamentId,configHash,handSeed,newSeed,resultCommitment,rosterCommitment,rulesHash} from './commitments';
import {advanceOperation,latestOperation,prepareOperation,reconcileOperations} from './operations';
import {publicAgent,publicTournament,type AgentRow,type EntryRow,type TournamentRow} from './types';

const arc=createPublicClient({chain:arcTestnet,transport:http(process.env.ARC_RPC_URL||'https://rpc.testnet.arc.network',{timeout:10000,retryCount:1})});
const usdc=(process.env.ARC_USDC_ADDRESS||'0x3600000000000000000000000000000000000000') as Address;
const factory=()=>{const value=process.env.ARENA_FACTORY_ADDRESS;if(!value)throw new Error('Arena V2 factory is not configured');return value as Address;};
const operatorWallet=()=>{const value=process.env.ARENA_OPERATOR_WALLET_ID;if(!value)throw new Error('Circle operator wallet ID is not configured');return value;};
const operatorAddress=()=>{const value=process.env.ARENA_OPERATOR_ADDRESS;if(!value)throw new Error('Arc operator address is not configured');return value as Address;};
const micro=(value:unknown)=>{if(typeof value!=='string'||!/^\d+(\.\d{1,6})?$/.test(value))throw new Error('USDC amount must be positive with at most six decimals');const parsed=parseUnits(value,6);if(parsed<1n||parsed>1_000_000_000_000n)throw new Error('USDC amount is outside supported testnet range');return parsed;};

export async function listAgents(){const r=await pool.query<AgentRow>('SELECT * FROM arena_agents ORDER BY created_at DESC LIMIT 200');return r.rows.map(a=>publicAgent(a));}
export async function listTournaments(){const r=await pool.query<TournamentRow>('SELECT * FROM arena_tournaments ORDER BY created_at DESC LIMIT 100');return Promise.all(r.rows.map(async t=>publicTournament(t,(await pool.query<EntryRow>('SELECT agent_id,state FROM arena_entries WHERE tournament_id=$1 ORDER BY agent_id',[t.id])).rows)));}
export async function getTournament(id:string){const r=await pool.query<TournamentRow>('SELECT * FROM arena_tournaments WHERE id=$1',[id]);const t=r.rows[0];if(!t)return null;const entries=(await pool.query<EntryRow>(`SELECT e.*,a.wallet_address FROM arena_entries e JOIN arena_agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 ORDER BY a.created_at`,[id])).rows;return{row:t,entries,public:publicTournament(t,entries)};}
export async function getAgent(id:string){const r=await pool.query<AgentRow>('SELECT * FROM arena_agents WHERE id=$1',[id]);return r.rows[0]||null;}

export async function createAgent(owner:string,input:Record<string,unknown>){
  const name=String(input.name||'').trim().toUpperCase(),strategy=String(input.strategy||'').trim(),model=String(input.model||'').trim(),description=String(input.description||'').trim();
  if(!/^[A-Z0-9][A-Z0-9 _-]{1,19}$/.test(name))throw new Error('Agent name must be 2–20 letters, numbers, spaces, underscores or hyphens');
  if(!['Aggressive','Conservative','Balanced','Bluff Heavy','Mathematical','Adaptive','Custom'].includes(strategy))throw new Error('Choose a supported strategy');
  const allowed=(process.env.MODEL_ALLOWED_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!process.env.MODEL_API_KEY||!allowed.includes(model))throw new Error('Selected model is not configured by the arena operator');
  if(description.length>500)throw new Error('Strategy description is too long');
  const owned=await pool.query<{n:string}>('SELECT count(*)::text AS n FROM arena_agents WHERE owner=$1',[owner]);
  if(Number(owned.rows[0].n)>=5)throw new Error('Each creator can register up to five agents');
  const id=randomUUID(),walletKey=randomUUID();
  await pool.query(`INSERT INTO arena_agents(id,owner,name,strategy,model,description,wallet_key) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,owner,name,strategy,model,description,walletKey]);
  await provisionAgentWallet(id,owner);
  return publicAgent((await getAgent(id))!);
}
export async function provisionAgentWallet(id:string,owner:string){
  const agent=await getAgent(id);if(!agent||agent.owner!==owner)throw new Error('Agent not found for this owner');
  if(agent.wallet_id&&agent.wallet_address)return publicAgent(agent);
  const wallet=await provisionCircleWallet(id,agent.name,agent.wallet_key);
  await pool.query('UPDATE arena_agents SET wallet_id=$2,wallet_address=$3 WHERE id=$1 AND wallet_id IS NULL',[id,wallet.id,wallet.address.toLowerCase()]);
  return publicAgent((await getAgent(id))!);
}

export async function createTournament(owner:string,input:Record<string,unknown>){
  const name=String(input.name||'').trim(),entry=micro(input.entryUsdc);
  const capacity=Number(input.capacity),duration=Number(input.durationSeconds),stack=Number(input.startingStack);
  const shares=input.shares;
  if(name.length<3||name.length>60||!Number.isSafeInteger(capacity)||capacity<2||capacity>9||!Number.isSafeInteger(duration)||duration<300||duration>86400||!Number.isSafeInteger(stack)||stack<100||stack>1000000)throw new Error('Invalid tournament settings');
  if(!Array.isArray(shares)||shares.length<1||shares.length>capacity||shares.some(n=>!Number.isInteger(n)||n<=0)||shares.reduce((a,b)=>a+b,0)!==10000)throw new Error('Prize shares must total 10000 basis points');
  const minimumEntrants=Math.max(2,shares.length);
  if(shares.some(share=>entry*BigInt(minimumEntrants)*BigInt(share)<10000n))throw new Error('Each prize place must receive at least one USDC base unit');
  const active=await pool.query<{n:string}>(`SELECT count(*)::text AS n FROM arena_tournaments WHERE creator=$1 AND state NOT IN ('settled','cancelled')`,[owner]);
  if(Number(active.rows[0].n)>=3)throw new Error('Finish an active tournament before creating another');
  const id=randomUUID(),seed=newSeed();
  await pool.query(`INSERT INTO arena_tournaments(id,creator,name,entry_micro,starting_stack,capacity,duration_seconds,shares,state,seed_secret,seed_commitment)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'draft',$9,$10)`,[id,owner,name,entry.toString(),stack,capacity,duration,JSON.stringify(shares),seed.seed,seed.commitment]);
  return(await getTournament(id))!.public;
}
export async function reserveSeat(owner:string,tournamentId:string,agentId:string){
  await withTx(async client=>{
    const tr=await client.query<TournamentRow>('SELECT * FROM arena_tournaments WHERE id=$1 FOR UPDATE',[tournamentId]);const t=tr.rows[0];
    if(!t||t.state!=='draft')throw new Error('Roster is closed');
    const agent=(await client.query<AgentRow>('SELECT * FROM arena_agents WHERE id=$1',[agentId])).rows[0];
    if(!agent||agent.owner!==owner||!agent.wallet_id||!agent.wallet_address)throw new Error('A Circle Arc wallet owned by you is required');
    const count=await client.query<{n:string}>('SELECT count(*)::text AS n FROM arena_entries WHERE tournament_id=$1',[tournamentId]);
    if(Number(count.rows[0].n)>=t.capacity)throw new Error('Roster is full');
    await client.query('INSERT INTO arena_entries(tournament_id,agent_id,owner,config_hash) VALUES($1,$2,$3,$4)',[tournamentId,agentId,owner,configHash({...agent,walletAddress:agent.wallet_address})]);
  });
  return(await getTournament(tournamentId))!.public;
}

export async function launchTournament(owner:string,id:string){
  if(!process.env.MODEL_API_KEY)throw new Error('Arena model provider is not configured');
  await requireArcV2Deployment(factory(),usdc,operatorAddress());
  const t=await withTx(async client=>{
    const tr=await client.query<TournamentRow>('SELECT * FROM arena_tournaments WHERE id=$1 FOR UPDATE',[id]);const row=tr.rows[0];
    if(!row||row.creator!==owner||!['draft','deploying'].includes(row.state))throw new Error('Only the creator can launch an open draft');
    if(row.state==='deploying')return row;
    const entries=(await client.query<EntryRow>(`SELECT e.*,a.wallet_id,a.wallet_address,a.name,a.strategy,a.model,a.description FROM arena_entries e JOIN arena_agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 ORDER BY e.agent_id`,[id])).rows;
    if(entries.length!==row.capacity)throw new Error('Fill all roster seats before locking the Arc contract');
    const roster=rosterCommitment(entries.map(e=>({agentId:e.agent_id,wallet:e.wallet_address as Address,configHash:e.config_hash as Hex})));
    const rules=rulesHash({id,entryMicro:row.entry_micro,startingStack:row.starting_stack,capacity:row.capacity,durationSeconds:row.duration_seconds,shares:row.shares});
    const closes=new Date(Date.now()+15*60_000);
    await client.query(`UPDATE arena_tournaments SET state='deploying',rules_hash=$2,roster_root=$3,closes_at=$4 WHERE id=$1`,[id,rules,roster.root,closes]);
    for(let i=0;i<entries.length;i++)await client.query('UPDATE arena_entries SET proof=$3::jsonb WHERE tournament_id=$1 AND agent_id=$2',[id,entries[i].agent_id,JSON.stringify(roster.proofs[i])]);
    return{...row,rules_hash:rules,roster_root:roster.root,closes_at:closes};
  });
  const chainId=chainTournamentId(id);
  await prepareOperation({key:`create:${id}`,kind:'create',tournamentId:id,walletId:operatorWallet(),expectedContract:factory(),
    call:{kind:'create',factory:factory(),id:chainId,rulesHash:t.rules_hash as Hex,rosterRoot:t.roster_root as Hex,seedCommitment:t.seed_commitment as Hex,
      entryFeeMicroUsdc:BigInt(t.entry_micro),capacity:t.capacity,closesAt:BigInt(Math.floor(t.closes_at!.getTime()/1000)),duration:BigInt(t.duration_seconds),grace:3600n,shares:t.shares},
    expected:{kind:'created',tournamentId:chainId}});
  return advanceOperation(`create:${id}`);
}

export async function submitEntry(owner:string,id:string,agentId:string){
  const data=await getTournament(id);if(!data||!data.row.contract_address||data.row.state!=='funding')throw new Error('Arc registration is not open');
  const e=data.entries.find(e=>e.agent_id===agentId&&e.owner===owner);
  if(!e)throw new Error('This agent is not in your reserved roster');
  if(e.state==='entered')return{state:'entered'};
  if(e.state==='entering'||e.state==='approving')return(await latestOperation(e.state==='approving'?'approve':'enter',id,agentId))||{state:'pending'};
  const agent=await getAgent(agentId);if(!agent?.wallet_id||!agent.wallet_address)throw new Error('Circle wallet missing');
  const balance=await getCircleUsdcBalance(agent.wallet_id);
  if(parseUnits(balance,6)<BigInt(data.row.entry_micro)+100_000n)throw new Error('Fund this agent with the entry fee plus at least 0.10 USDC reserved for Arc gas');
  if(!((await arc.getCode({address:ARC_MULTICALL_FROM}))?.replace(/^0x/,'')))throw new Error('Arc Multicall3From is not available');
  const simulation=buildArcV2Call({kind:'atomic-entry',usdc,tournament:data.row.contract_address as Address,amountMicroUsdc:BigInt(data.row.entry_micro),agentId:chainAgentId(agentId),configHash:e.config_hash as Hex,proof:e.proof as Hex[]});
  await arc.call({account:agent.wallet_address as Address,to:simulation.contractAddress,data:simulation.callData});
  const key=`entry-atomic:${id}:${agentId}`;
  await prepareOperation({key,kind:'enter',tournamentId:id,agentId,walletId:agent.wallet_id,expectedContract:ARC_MULTICALL_FROM,
    call:{kind:'atomic-entry',usdc,tournament:data.row.contract_address as Address,amountMicroUsdc:BigInt(data.row.entry_micro),agentId:chainAgentId(agentId),configHash:e.config_hash as Hex,proof:e.proof as Hex[]},
    expected:{kind:'atomic-entry',usdc,tournament:data.row.contract_address as Address,tournamentId:chainTournamentId(id),agentId:chainAgentId(agentId),wallet:agent.wallet_address as Address,configHash:e.config_hash as Hex,amountMicroUsdc:BigInt(data.row.entry_micro)}});
  await pool.query(`UPDATE arena_entries SET state='entering' WHERE tournament_id=$1 AND agent_id=$2 AND state='reserved'`,[id,agentId]);
  return advanceOperation(key);
}

async function syncCreated(t:TournamentRow){
  const op=await latestOperation('create',t.id);
  if(op?.state!=='confirmed')return;
  const contract=await arc.readContract({address:factory(),abi:factoryV2Abi,functionName:'tournamentById',args:[chainTournamentId(t.id)]});
  if(contract==='0x0000000000000000000000000000000000000000')return;
  await pool.query(`UPDATE arena_tournaments SET state='funding',contract_address=$2 WHERE id=$1 AND state='deploying'`,[t.id,contract.toLowerCase()]);
}
async function syncEntries(t:TournamentRow){
  const entries=(await pool.query<EntryRow>(`SELECT e.*,a.wallet_id,a.wallet_address FROM arena_entries e JOIN arena_agents a ON a.id=e.agent_id WHERE e.tournament_id=$1`,[t.id])).rows;
  for(const e of entries){
    if(e.state==='approving'){
      const op=await latestOperation('approve',t.id,e.agent_id);
      if(op?.state==='confirmed'){
        const key=`enter:${t.id}:${e.agent_id}`;
        await prepareOperation({key,kind:'enter',tournamentId:t.id,agentId:e.agent_id,walletId:e.wallet_id,expectedContract:t.contract_address as Address,
          call:{kind:'enter',tournament:t.contract_address as Address,agentId:chainAgentId(e.agent_id),configHash:e.config_hash as Hex,proof:e.proof as Hex[]},
          expected:{kind:'registered',tournamentId:chainTournamentId(t.id),agentId:chainAgentId(e.agent_id),wallet:e.wallet_address as Address}});
        await pool.query(`UPDATE arena_entries SET state='entering' WHERE tournament_id=$1 AND agent_id=$2 AND state='approving'`,[t.id,e.agent_id]);
        await advanceOperation(key);
      }
    }else if(e.state==='entering'){
      const op=await latestOperation('enter',t.id,e.agent_id);
      if(op?.state==='confirmed')await pool.query(`UPDATE arena_entries SET state='entered' WHERE tournament_id=$1 AND agent_id=$2 AND state='entering'`,[t.id,e.agent_id]);
    }
  }
  const entered=(await pool.query<{n:string}>(`SELECT count(*)::text AS n FROM arena_entries WHERE tournament_id=$1 AND state='entered'`,[t.id])).rows[0];
  if(Date.now()>t.closes_at!.getTime()&&Number(entered.n)<Math.max(2,t.shares.length)){
    const key=`cancel:${t.id}`;
    await prepareOperation({key,kind:'cancel',tournamentId:t.id,walletId:operatorWallet(),expectedContract:t.contract_address as Address,
      call:{kind:'cancelIfUnfilled',tournament:t.contract_address as Address},expected:{kind:'cancelled',tournamentId:chainTournamentId(t.id)}});
    await pool.query(`UPDATE arena_tournaments SET state='cancelling' WHERE id=$1 AND state='funding'`,[t.id]);
    await advanceOperation(key);return;
  }
  if(Number(entered.n)>=Math.max(2,t.shares.length)&&(Number(entered.n)===t.capacity||Date.now()>t.closes_at!.getTime())){
    const key=`start:${t.id}`;
    await prepareOperation({key,kind:'start',tournamentId:t.id,walletId:operatorWallet(),expectedContract:t.contract_address as Address,
      call:{kind:'start',tournament:t.contract_address as Address},expected:{kind:'started',tournamentId:chainTournamentId(t.id)}});
    await pool.query(`UPDATE arena_tournaments SET state='starting' WHERE id=$1 AND state='funding'`,[t.id]);
    await advanceOperation(key);
  }
}
async function syncCancelled(t:TournamentRow){
  const op=await latestOperation('cancel',t.id);
  if(op?.state!=='confirmed')return;
  await pool.query(`UPDATE arena_tournaments SET state='cancelled',ended_at=now() WHERE id=$1 AND state='cancelling'`,[t.id]);
}
async function refundEntries(t:TournamentRow){
  const entries=(await pool.query<EntryRow>(`SELECT e.*,a.wallet_id,a.wallet_address FROM arena_entries e JOIN arena_agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 AND e.state='entered'`,[t.id])).rows;
  for(const e of entries){
    const key=`refund:${t.id}:${e.agent_id}`;
    await prepareOperation({key,kind:'refund',tournamentId:t.id,agentId:e.agent_id,walletId:e.wallet_id,expectedContract:t.contract_address as Address,
      call:{kind:'refund',tournament:t.contract_address as Address},expected:{kind:'refunded',tournamentId:chainTournamentId(t.id),wallet:e.wallet_address as Address,amountMicroUsdc:BigInt(t.entry_micro)}});
    await advanceOperation(key);
  }
  if((await Promise.all(entries.map(e=>latestOperation('refund',t.id,e.agent_id)))).every(op=>op?.state==='confirmed'))
    await pool.query('UPDATE arena_tournaments SET refunds_complete=true WHERE id=$1',[t.id]);
}
async function syncStarted(t:TournamentRow){
  const op=await latestOperation('start',t.id);
  if(op?.state!=='confirmed')return;
  const entries=(await pool.query<{agent_id:string}>(`SELECT agent_id FROM arena_entries WHERE tournament_id=$1 AND state='entered' ORDER BY agent_id`,[t.id])).rows;
  const stacks=Object.fromEntries(entries.map(e=>[e.agent_id,t.starting_stack]));
  const [started,startedAt]=await Promise.all([
    arc.readContract({address:t.contract_address as Address,abi:tournamentV2Abi,functionName:'state'}),
    arc.readContract({address:t.contract_address as Address,abi:tournamentV2Abi,functionName:'startedAt'}),
  ]);
  if(started!==1)return;
  await pool.query(`UPDATE arena_tournaments SET state='running',started_at=$3,stacks=$2::jsonb WHERE id=$1 AND state='starting'`,[t.id,JSON.stringify(stacks),new Date(Number(startedAt)*1000)]);
}

async function completeTournament(t:TournamentRow){
  const ranking=Object.entries(t.stacks).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(x=>x[0]);
  const entries=(await pool.query<EntryRow>(`SELECT e.*,a.wallet_address FROM arena_entries e JOIN arena_agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 AND e.state='entered'`,[t.id])).rows;
  const addresses=ranking.map(id=>entries.find(e=>e.agent_id===id)?.wallet_address).filter(Boolean) as Address[];
  if(addresses.length<t.shares.length)throw new Error('Ranking has fewer paid entrants than prize places');
  const result=resultCommitment({tournamentId:t.id,ranking,stacks:t.stacks});
  const replay=resultCommitment({tournamentId:t.id,history:t.history});
  const key=`finalize:${t.id}`;
  await prepareOperation({key,kind:'finalize',tournamentId:t.id,walletId:operatorWallet(),expectedContract:t.contract_address as Address,
    call:{kind:'finalize',tournament:t.contract_address as Address,resultRoot:result,replayHash:replay,seedReveal:t.seed_secret as Hex,ranking:addresses.slice(0,t.shares.length)},
    expected:{kind:'finalized',tournamentId:chainTournamentId(t.id)}});
  await pool.query(`UPDATE arena_tournaments SET state='finalizing',ranking=$2::jsonb,winner_id=$3,result_hash=$4,replay_hash=$5,ended_at=now() WHERE id=$1 AND state='running'`,[t.id,JSON.stringify(ranking),ranking[0],result,replay]);
  await advanceOperation(key);
}

async function syncFinalized(t:TournamentRow){
  const op=await latestOperation('finalize',t.id);
  if(op?.state!=='confirmed')return;
  await pool.query(`UPDATE arena_tournaments SET state='settled' WHERE id=$1 AND state='finalizing'`,[t.id]);
}
async function claimPrizes(t:TournamentRow){
  const winners=(t.ranking||[]).slice(0,t.shares.length);
  for(const id of winners){
    const a=await getAgent(id);if(!a?.wallet_id||!a.wallet_address)continue;
    const amount=await arc.readContract({address:t.contract_address as Address,abi:tournamentV2Abi,functionName:'claimable',args:[a.wallet_address as Address]});
    if(amount===0n)continue;
    const key=`claim:${t.id}:${id}`;
    await prepareOperation({key,kind:'claim',tournamentId:t.id,agentId:id,walletId:a.wallet_id,expectedContract:t.contract_address as Address,
      call:{kind:'claim',tournament:t.contract_address as Address},expected:{kind:'paid',tournamentId:chainTournamentId(t.id),wallet:a.wallet_address as Address,amountMicroUsdc:amount}});
    await advanceOperation(key);
  }
  if((await Promise.all(winners.map(id=>latestOperation('claim',t.id,id)))).every(op=>op?.state==='confirmed'))
    await pool.query('UPDATE arena_tournaments SET claims_complete=true WHERE id=$1',[t.id]);
}

async function runHand(t:TournamentRow,onAction?:(action:HandDecision,tournamentId:string)=>void,onTurn?:(turn:PublicTurn,tournamentId:string)=>void){
  const client=await pool.connect();
  try{
    const lock=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[`hand:${t.id}`]);if(!lock.rows[0]?.locked)return;
    try{
      const latest=(await client.query<TournamentRow>('SELECT * FROM arena_tournaments WHERE id=$1',[t.id])).rows[0];
      if(latest.state!=='running')return;
      const seats=(await client.query<EntryRow>(`SELECT e.*,a.name,a.strategy,a.model,a.description FROM arena_entries e JOIN arena_agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 AND e.state='entered' ORDER BY e.agent_id`,[t.id])).rows
        .filter(e=>(latest.stacks[e.agent_id]||0)>0).map(e=>({id:e.agent_id,name:e.name,stack:latest.stacks[e.agent_id],strategy:e.strategy,model:e.model,description:e.description}));
      if(seats.length<2||Date.now()>=latest.started_at!.getTime()+latest.duration_seconds*1000){await completeTournament(latest);return;}
      const provider=new OpenAICompatibleProvider({baseUrl:process.env.MODEL_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.MODEL_API_KEY!,model:''});
      const hand=await playHand({seed:handSeed(latest.seed_secret as Hex,latest.id,latest.hand_number+1),handNumber:latest.hand_number+1,seats,button:latest.button%seats.length,
        smallBlind:Math.min(10000,10*latest.blind_level),bigBlind:Math.min(20000,20*latest.blind_level),timeoutMs:Math.min(30000,Math.max(1000,Number(process.env.AGENT_TIMEOUT_MS||4000)||4000)),
        provider:(ctx:DecisionContext)=>provider.decide(ctx),onTurn:turn=>onTurn?.(turn,latest.id),onDecision:d=>onAction?.(d,latest.id)});
      const stacks={...latest.stacks};for(const p of hand.players)stacks[p.id]=p.stack;
      await client.query(`UPDATE arena_tournaments SET history=history||$2::jsonb,stacks=$3::jsonb,hand_number=hand_number+1,button=button+1,
        blind_level=CASE WHEN (hand_number+1)%10=0 THEN blind_level+1 ELSE blind_level END WHERE id=$1 AND hand_number=$4 AND state='running'`,
        [latest.id,JSON.stringify([hand]),JSON.stringify(stacks),latest.hand_number]);
    }finally{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[`hand:${t.id}`]);}
  }finally{client.release();}
}

export async function tickArena(onAction?:(action:HandDecision,tournamentId:string)=>void,onTurn?:(turn:PublicTurn,tournamentId:string)=>void){
  await reconcileOperations();
  const rows=(await pool.query<TournamentRow>(`SELECT * FROM arena_tournaments WHERE state IN ('deploying','funding','starting','running','finalizing','cancelling') OR (state='settled' AND NOT claims_complete) OR (state='cancelled' AND NOT refunds_complete) ORDER BY created_at`)).rows;
  for(const t of rows)try{
    if((t.state==='running'||t.state==='finalizing')&&t.started_at&&Date.now()>t.started_at.getTime()+(t.duration_seconds+3600)*1000+10_000){
      const state=await arc.readContract({address:t.contract_address as Address,abi:tournamentV2Abi,functionName:'state'});
      if(state===2){await pool.query(`UPDATE arena_tournaments SET state='settled' WHERE id=$1`,[t.id]);continue;}
      if(state===3){await pool.query(`UPDATE arena_tournaments SET state='cancelled' WHERE id=$1`,[t.id]);continue;}
      const key=`cancel:${t.id}`;
      await prepareOperation({key,kind:'cancel',tournamentId:t.id,walletId:operatorWallet(),expectedContract:t.contract_address as Address,
        call:{kind:'cancelExpired',tournament:t.contract_address as Address},expected:{kind:'cancelled',tournamentId:chainTournamentId(t.id)}});
      await pool.query(`UPDATE arena_tournaments SET state='cancelling' WHERE id=$1 AND state IN ('running','finalizing')`,[t.id]);
      await advanceOperation(key);continue;
    }
    if(t.state==='deploying')await syncCreated(t);
    else if(t.state==='funding')await syncEntries(t);
    else if(t.state==='starting')await syncStarted(t);
    else if(t.state==='running')await runHand(t,onAction,onTurn);
    else if(t.state==='finalizing')await syncFinalized(t);
    else if(t.state==='settled')await claimPrizes(t);
    else if(t.state==='cancelling')await syncCancelled(t);
    else if(t.state==='cancelled')await refundEntries(t);
  }catch(error){console.error('Arena transition failed',t.id,(error as Error).message);}
}

export async function walletBalance(agentId:string){const a=await getAgent(agentId);if(!a?.wallet_id)return null;return getCircleUsdcBalance(a.wallet_id);}
export async function walletOperations(agentId:string){
  const r=await pool.query(`SELECT state,tx_hash,expected->>'amountMicroUsdc' AS amount_micro,created_at,updated_at
    FROM arc_operations WHERE agent_id=$1 AND kind='withdraw' ORDER BY created_at DESC LIMIT 25`,[agentId]);
  return r.rows;
}
const validRequestId=(requestId:unknown):requestId is string=>typeof requestId==='string'&&/^([\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})$/i.test(requestId);
export function withdrawalAuthorizationMessage(input:{owner:string;agentId:string;wallet:string;amountUsdc:string;requestId:string;expiresAt:string}){
  return`Agent Arena Arc Testnet withdrawal\nDomain: ${process.env.PUBLIC_HOSTNAME||'localhost'}\nAgent: ${input.agentId}\nAgent wallet: ${input.wallet.toLowerCase()}\nCreator: ${input.owner.toLowerCase()}\nRecipient: ${input.owner.toLowerCase()}\nAmount: ${input.amountUsdc} USDC\nRequest: ${input.requestId}\nExpires: ${input.expiresAt}`;
}
export async function makeWithdrawalChallenge(owner:string,agentId:string,amountInput:unknown,requestId:unknown){
  if(!validRequestId(requestId))throw new Error('A UUIDv4 withdrawal request ID is required');
  micro(amountInput);
  const agent=await getAgent(agentId);
  if(!agent||agent.owner!==owner||!agent.wallet_id||!agent.wallet_address)throw new Error('Agent wallet not found for this owner');
  const expiresAt=new Date(Date.now()+5*60_000).toISOString();
  return{message:withdrawalAuthorizationMessage({owner,agentId,wallet:agent.wallet_address,amountUsdc:String(amountInput),requestId,expiresAt}),expiresAt};
}
export async function withdrawAgentFunds(owner:string,agentId:string,amountInput:unknown,requestId:unknown,expiresAt:unknown,message:unknown,signature:unknown){
  if(!validRequestId(requestId))throw new Error('A UUIDv4 withdrawal request ID is required');
  const amount=micro(amountInput);
  const agent=await getAgent(agentId);
  if(!agent||agent.owner!==owner||!agent.wallet_id||!agent.wallet_address)throw new Error('Agent wallet not found for this owner');
  const expiration=typeof expiresAt==='string'?Date.parse(expiresAt):NaN;
  if(!Number.isFinite(expiration)||expiration<Date.now()||expiration>Date.now()+5*60_000)throw new Error('Withdrawal authorization has expired');
  const expectedMessage=withdrawalAuthorizationMessage({owner,agentId,wallet:agent.wallet_address,amountUsdc:String(amountInput),requestId,expiresAt:expiresAt as string});
  if(message!==expectedMessage||typeof signature!=='string'||!await verifyMessage({address:owner as Address,message:expectedMessage,signature:signature as Hex}).catch(()=>false))throw new Error('A fresh creator wallet signature is required for this withdrawal');
  const walletId=agent.wallet_id;
  const key=`withdraw:${agentId}:${requestId}`;
  await withTx(async client=>{
    const locked=(await client.query<AgentRow>('SELECT * FROM arena_agents WHERE id=$1 FOR UPDATE',[agentId])).rows[0];
    if(!locked||locked.owner!==owner||locked.wallet_id!==agent.wallet_id)throw new Error('Agent wallet ownership changed');
    const existing=(await client.query('SELECT operation_key FROM arc_operations WHERE operation_key=$1',[key])).rows[0];
    if(!existing){
      const active=await client.query(`SELECT 1 FROM arena_entries e JOIN arena_tournaments t ON t.id=e.tournament_id
        WHERE e.agent_id=$1 AND t.state='funding' AND e.state IN ('reserved','approving','entering') LIMIT 1`,[agentId]);
      if(active.rowCount)throw new Error('Finish or leave the active Arc entry before withdrawing');
      const pending=await client.query(`SELECT 1 FROM arc_operations WHERE agent_id=$1 AND kind='withdraw' AND state IN ('prepared','submitted') LIMIT 1`,[agentId]);
      if(pending.rowCount)throw new Error('A previous withdrawal is awaiting an Arc receipt');
    const balance=parseUnits(await getCircleUsdcBalance(walletId),6);
      if(balance<amount+100_000n)throw new Error('Keep at least 0.10 USDC beyond the withdrawal amount for Arc gas');
    }
    await prepareOperation({key,kind:'withdraw',agentId,walletId,expectedContract:usdc,
      call:{kind:'withdraw',usdc,recipient:owner as Address,amountMicroUsdc:amount},
      expected:{kind:'transfer',sender:agent.wallet_address as Address,recipient:owner as Address,amountMicroUsdc:amount}},client);
  });
  return advanceOperation(key);
}
export async function operationHistory(tournamentId:string){const r=await pool.query(`SELECT kind,agent_id,state,tx_hash,created_at,updated_at FROM arc_operations WHERE tournament_id=$1 ORDER BY created_at`,[tournamentId]);return r.rows;}
export async function replayHand(tournamentId:string,handNumber:number){const t=(await getTournament(tournamentId))?.row;return t?.history.find(h=>h.handNumber===handNumber)||null;}
export async function verifyMatch(tournamentId:string){
  const t=(await getTournament(tournamentId))?.row;if(!t)return null;
  const handChecks=await Promise.all(t.history.map(async h=>({handNumber:h.handNumber,valid:await replayMatches(h,{smallBlind:Math.min(10000,10*(Math.floor((h.handNumber-1)/10)+1)),bigBlind:Math.min(20000,20*(Math.floor((h.handNumber-1)/10)+1))}),
    seedMatches:handSeed(t.seed_secret as Hex,t.id,h.handNumber)===h.seed})));
  const operation=await latestOperation('finalize',t.id);
  const onchain=t.contract_address?await arc.readContract({address:t.contract_address as Address,abi:tournamentV2Abi,functionName:'state'}).catch(()=>null):null;
  return{tournamentId:t.id,handChecks,engineReplayVerified:handChecks.length>0&&handChecks.every(h=>h.valid&&h.seedMatches),
    seedCommitment:t.seed_commitment,seedCommitmentMatches:keccak256(t.seed_secret as Hex)===t.seed_commitment,seedReveal:t.state==='settled'?t.seed_secret:null,
    resultHash:t.result_hash,replayHash:t.replay_hash,
    settlementConfirmed:operation?.state==='confirmed'&&onchain===2,settlementTxHash:operation?.tx_hash||null,
    trust:'The arena operator selected the seed and asserted the final ranking. Replay verifies deterministic execution, not unbiased randomness.'};
}

export async function leaderboard(){
  const agents=(await pool.query<AgentRow>('SELECT * FROM arena_agents')).rows;
  const tournaments=(await pool.query<TournamentRow>(`SELECT * FROM arena_tournaments WHERE state='settled'`)).rows;
  const entries=(await pool.query<{tournament_id:string;agent_id:string}>(`SELECT tournament_id,agent_id FROM arena_entries WHERE state='entered'`)).rows;
  const claims=(await pool.query<{tournament_id:string;agent_id:string;amount:string}>(`SELECT o.tournament_id,o.agent_id,(o.expected->>'amountMicroUsdc') AS amount FROM arc_operations o WHERE kind='claim' AND state='confirmed'`)).rows;
  const rows=agents.map(a=>{
    const played=tournaments.filter(t=>entries.some(e=>e.tournament_id===t.id&&e.agent_id===a.id));
    const fees=played.reduce((s,t)=>s+BigInt(t.entry_micro),0n);
    const winnings=claims.filter(c=>played.some(t=>t.id===c.tournament_id)&&c.agent_id===a.id).reduce((s,c)=>s+BigInt(c.amount),0n);
    const profit=winnings-fees,wins=played.filter(t=>t.winner_id===a.id).length;
    const hands=played.reduce((s,t)=>s+t.history.filter(h=>h.players.some(p=>p.id===a.id)).length,0);
    const roi=fees>0n?Number(profit*10000n/fees)/100:0;
    return{id:a.id,name:a.name,strategy:a.strategy,model:a.model,walletAddress:a.wallet_address,tournaments:played.length,wins,hands,profitMicro:profit.toString(),winningsMicro:winnings.toString(),feesMicro:fees.toString(),roi,winRate:played.length?wins/played.length:0,reputation:Math.min(1000,wins*100+played.length*5+Math.max(0,Math.floor(roi)))};
  });
  rows.sort((a,b)=>BigInt(b.profitMicro)>BigInt(a.profitMicro)?1:BigInt(b.profitMicro)<BigInt(a.profitMicro)?-1:b.wins-a.wins);
  return rows.map((r,i)=>({rank:i+1,...r}));
}

export async function agentAnalytics(agentId:string){
  const agent=await getAgent(agentId);if(!agent)return null;
  const tournaments=(await pool.query<TournamentRow>(`SELECT t.* FROM arena_tournaments t JOIN arena_entries e ON e.tournament_id=t.id WHERE e.agent_id=$1 ORDER BY t.created_at`,[agentId])).rows;
  const hands=tournaments.flatMap(t=>t.history.filter(h=>h.players.some(p=>p.id===agentId)));
  const decisions=hands.flatMap(h=>h.decisions.filter(d=>d.agentId===agentId));
  const count=(action:string)=>decisions.filter(d=>d.action===action).length;
  const voluntary=hands.filter(h=>h.decisions.some(d=>d.agentId===agentId&&d.stage==='preflop'&&['call','raise','all-in'].includes(d.action))).length;
  const preflopRaises=hands.filter(h=>h.decisions.some(d=>d.agentId===agentId&&d.stage==='preflop'&&['raise','all-in'].includes(d.action))).length;
  const showdowns=hands.filter(h=>h.players.filter(p=>!p.folded).length>1);
  const wonShowdowns=showdowns.filter(h=>h.winnerIds.includes(agentId)).length;
  const potsWon=hands.map(h=>h.payouts[agentId]||0);
  const bankroll=hands.map(h=>({hand:h.handNumber,tournamentId:tournaments.find(t=>t.history.some(x=>x===h))?.id||null,stack:h.players.find(p=>p.id===agentId)?.stack||0}));
  const finished=tournaments.filter(t=>t.state==='settled').map(t=>({tournamentId:t.id,name:t.name,finish:(t.ranking||[]).indexOf(agentId)+1,entrants:Object.keys(t.stacks).length}));
  return{agentId,hands:hands.length,decisions:decisions.length,vpip:hands.length?voluntary/hands.length:0,pfr:hands.length?preflopRaises/hands.length:0,
    aggression:count('call')?(count('raise')+count('all-in'))/count('call'):count('raise')+count('all-in'),
    averageDecisionMs:decisions.length?Math.round(decisions.reduce((n,d)=>n+d.latencyMs,0)/decisions.length):0,
    averageBetChips:decisions.length?Math.round(decisions.reduce((n,d)=>n+d.amount,0)/decisions.length):0,
    showdownWinRate:showdowns.length?wonShowdowns/showdowns.length:0,biggestPotChips:Math.max(0,...potsWon),
    bankroll,finishes:finished,actionCounts:{raises:count('raise'),calls:count('call'),folds:count('fold'),checks:count('check'),allIns:count('all-in')},
    note:'VPIP and PFR are measured from recorded preflop actions. Bluff frequency is omitted because intent cannot be inferred reliably from public action data.'};
}
