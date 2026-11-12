import {useEffect,useState} from 'react';
import {ArrowRight,Award,Bot,Cpu,Dices,ExternalLink,Gift,KeyRound,Repeat,ShieldCheck,Wallet} from 'lucide-react';
import {depositToAgent,nearToYocto,withdrawFromAgent} from './near';

export type NearConfig={network:'testnet'|'mainnet';rpcUrl:string;explorer:string;contractId:string|null;models:string[];decisionPolicy:string;nearAiReady:boolean;nearReady:boolean;
  fundingSources:{id:string;label:string}[];intentsReady:boolean;fastAuth:{contractId:string;mpcContractId:string;clientId:string|null};sponsorNear:number;agentMarket:{enabled:boolean;lastPollAt:string|null;lastError:string|null;delivered:number;listing:string|null}};
type AccessKey={publicKey:string;role:string;permission:'FullAccess'|{receiverId:string;methodNames:string[];allowance:string|null}};
type AgentWallet={trophies:{tokenId:string;balance:string}[];nearAccount:string;explorer:string;contractId:string;arenaBalanceNear:string;accountBalanceNear:string|null;accessKeys:AccessKey[];createTx:string|null;onchainRecord:{owner:string;tournaments:number;wins:number}|null};
type Quote={source:string;amountIn:string;amountInUsd:string;amountOut:string;timeEstimateSeconds:number;note:string};
type Attestation={model:string;nonce:string;checkedAt:string;nonceEchoed:boolean;modelSigners:string[];gatewaySigners:string[];gpu:{overallResult:boolean;nonceMatch:boolean|null;gpus:{key:string;hwmodel:string|null}[]}|null;intelQuotePresent:boolean;verified:boolean;notes:string[]};
type Receipt={hand_number:number;agent:string;model:string;chat_id:string;signature_kind:string|null;signer:string|null;verified:boolean;detail:string|null};

async function get<T>(path:string):Promise<T>{const r=await fetch(path,{credentials:'same-origin'});const d=await r.json();if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d as T;}
async function post<T>(path:string,body:unknown):Promise<T>{const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d as T;}
const short=(v:string|null|undefined,n=8)=>v?(v.length>2*n+1?`${v.slice(0,n)}…${v.slice(-n+2)}`:v):'—';
const yoctoNear=(v:string)=>{const b=BigInt(v);return`${b/10n**24n}.${(b%10n**24n).toString().padStart(24,'0').slice(0,3)}`;};

/** Agent account panel: arena balance, the two access keys (and what each may do), deposit/withdraw, Intents quote. */
export function AgentNearPanel({agentId,owned,config,notify}:{agentId:string;owned:boolean;config:NearConfig|null;notify:(m:string)=>void}){
  const [wallet,setWallet]=useState<AgentWallet|null>(null),[amount,setAmount]=useState('1'),[busy,setBusy]=useState(false),[source,setSource]=useState('usdc-base'),[quote,setQuote]=useState<Quote|null>(null);
  const load=()=>void get<AgentWallet>(`/api/agents/${agentId}/wallet`).then(setWallet).catch(()=>{});
  useEffect(()=>{load();const t=setInterval(load,8000);return()=>clearInterval(t);},[agentId]);
  const act=async(kind:'deposit'|'withdraw')=>{
    if(!config?.contractId||!wallet)return;setBusy(true);
    try{const via=await(kind==='deposit'?depositToAgent:withdrawFromAgent)(config.network,config.contractId,wallet.nearAccount,amount);notify(`${kind==='deposit'?'Deposit confirmed onchain':'Withdrawal sent to your wallet'}${via==='relayed'?' · gas paid by the arena relayer':''}.`);load();}
    catch(e){notify((e as Error).message);}finally{setBusy(false);}
  };
  const sponsor=async()=>{setBusy(true);try{await post(`/api/agents/${agentId}/sponsor`,{});notify(`Starter stake of ${config?.sponsorNear} testnet NEAR deposited by the arena.`);load();}catch(e){notify((e as Error).message);}finally{setBusy(false);}};
  const askQuote=async()=>{setBusy(true);try{setQuote(await post<Quote>('/api/intents/quote',{source,amountYocto:nearToYocto(amount)}));}catch(e){notify((e as Error).message);}finally{setBusy(false);}};
  if(!wallet)return <section className="content-panel"><div className="panel-heading"><span>NEAR AGENT ACCOUNT</span><Wallet size={18}/></div><p>Loading account…</p></section>;
  return <section className="content-panel near-panel"><div className="panel-heading"><span>NEAR AGENT ACCOUNT</span><Wallet size={18}/></div>
    <p>This agent is its own NEAR account, a sub-account of the arena contract. Its owner holds the full-access key; the arena server holds only a restricted key.</p>
    <div className="wallet-balance"><small>ARENA BALANCE (ESCROWED IN CONTRACT)</small><strong>{wallet.arenaBalanceNear}</strong><span>NEAR</span></div>
    <div className="address-line"><span>{wallet.nearAccount}</span></div>
    <a className="text-link" href={wallet.explorer} target="_blank" rel="noreferrer">VIEW ON NEARBLOCKS <ExternalLink size={16}/></a>
    {wallet.createTx&&<a className="text-link" href={wallet.createTx} target="_blank" rel="noreferrer">ACCOUNT CREATION TX <ExternalLink size={16}/></a>}
    <div className="key-list"><small><KeyRound size={13}/> ACCESS KEYS (READ FROM CHAIN)</small>{wallet.accessKeys.map(k=><div className="key-row" key={k.publicKey}><b>{k.role.toUpperCase()}</b><code>{short(k.publicKey,12)}</code>
      <span>{k.permission==='FullAccess'?'Full access':`Only ${k.permission.methodNames.join(', ')} on ${k.permission.receiverId}${k.permission.allowance?` · gas cap ${yoctoNear(k.permission.allowance)} NEAR`:''} · cannot attach deposits`}</span></div>)}</div>
    {owned&&<><div className="form-row"><input aria-label="Amount in NEAR" value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="NEAR"/>
      <button disabled={busy} onClick={()=>void act('deposit')}>DEPOSIT <ArrowRight size={15}/></button><button disabled={busy} onClick={()=>void act('withdraw')}>WITHDRAW</button></div>
      <p className="fund-hint">Deposit and withdraw are signed by your own wallet; when your wallet supports NEP-366 delegate actions the arena relayer pays the gas. Withdrawals always pay the owner account recorded in the contract.</p>
      {Boolean(config?.sponsorNear)&&<button className="quiet-link" disabled={busy} onClick={()=>void sponsor()}><Gift size={14}/> CLAIM {config?.sponsorNear} NEAR TESTNET STARTER STAKE</button>}</>}
    <div className="key-list"><small><Award size={13}/> TROPHIES · NEP-245 (SOULBOUND)</small>{wallet.trophies.length?wallet.trophies.map(t=><div className="key-row" key={t.tokenId}><b>{t.tokenId.startsWith('trophy:')?'CHAMPION TROPHY':t.tokenId.toUpperCase()}</b><span>{t.tokenId.startsWith('trophy:')?`Tournament ${t.tokenId.slice(7,15)}…`:`× ${t.balance}`}</span></div>):<span className="fund-hint">Trophies are minted by the arena contract when this agent finishes in the money.</span>}</div>
    <div className="intents-box"><small><Repeat size={13}/> FUND FROM ANY CHAIN · NEAR INTENTS</small><div className="form-row"><select value={source} onChange={e=>setSource(e.target.value)}>{config?.fundingSources.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
      <button disabled={busy||!config?.intentsReady} onClick={()=>void askQuote()}>QUOTE {amount} NEAR</button></div>
      {!config?.intentsReady&&<p className="fund-hint">Intents quotes need a mainnet recipient configured on the server.</p>}
      {quote&&<div className="quote"><b>{quote.amountIn} {quote.source}</b><span>≈ ${Number(quote.amountInUsd).toFixed(2)} → {quote.amountOut} NEAR · ~{quote.timeEstimateSeconds}s</span><small>{quote.note}</small></div>}</div>
  </section>;
}

/** Per-tournament privacy evidence: one signed TEE receipt per model decision. */
export function TeeReceiptsPanel({tournamentId,policy}:{tournamentId:string;policy:string|undefined}){
  const [rows,setRows]=useState<Receipt[]>([]);
  useEffect(()=>{const load=()=>void get<Receipt[]>(`/api/tournaments/${tournamentId}/tee-receipts`).then(setRows).catch(()=>{});load();const t=setInterval(load,6000);return()=>clearInterval(t);},[tournamentId]);
  const verified=rows.filter(r=>r.verified).length;
  return <section className="content-panel tx-panel"><div className="panel-heading"><span>PRIVATE INFERENCE RECEIPTS</span><span>{policy==='fixture'?'FIXTURE POLICY (NO MODEL)':`${verified}/${rows.length} TEE-SIGNED`}</span></div>
    <p>Each decision prompt holds that agent's private hole cards. It is sent only to a NEAR AI Cloud model running in a TEE. The arena keeps the sha256 of the exact request and response, then checks the enclave's signature over them against the attested signing key. The prompt itself is not stored.</p>
    {rows.slice(0,12).map((r,i)=><div className="tx-row" key={`${r.chat_id}-${i}`}><span className="tx-icon"><Cpu size={15}/></span><div><b>HAND {r.hand_number} · {r.agent}</b><small>{r.model} · {short(r.chat_id,10)}</small></div>
      <span className={`tag ${r.verified?'mint':''}`}>{r.verified?'TEE VERIFIED':r.detail?'UNVERIFIED':'CHECKING'}</span><small title={r.detail||''}>{r.signer?`${r.signature_kind} ${short(r.signer,6)}`:r.detail||''}</small></div>)}
    {!rows.length&&<p>{policy==='fixture'?'This arena runs the deterministic fixture policy, so no model is called.':'Receipts appear as soon as agents make decisions.'}</p>}</section>;
}

/** Deck entropy: OutLayer VRF requested by the contract and verified with ed25519_verify onchain. */
export function RandomnessPanel({tournamentId}:{tournamentId:string}){
  const [r,setR]=useState<{status:string;output_hex:string|null;alpha:string|null}|null|undefined>(undefined);
  const [configured,setConfigured]=useState<boolean|null>(null);
  useEffect(()=>{void get<{contract:{randomness_source?:unknown}|null}>('/api/health').then(h=>setConfigured(Boolean(h.contract?.randomness_source))).catch(()=>{});},[]);
  useEffect(()=>{const load=()=>void get<{randomness:typeof r}|null>(`/api/tournaments/${tournamentId}/onchain`).then(t=>setR(t?.randomness??null)).catch(()=>{});load();const i=setInterval(load,6000);return()=>clearInterval(i);},[tournamentId]);
  return <section className="content-panel"><div className="panel-heading"><span>VERIFIABLE SHUFFLE</span><Dices size={17}/></div>
    {r?.status==='verified'?<><span className="tag mint">VRF VERIFIED ONCHAIN</span><p>OutLayer's TEE produced this value; the arena contract checked its Ed25519 proof before storing it. Every deck mixes it with the operator's pre-committed seed.</p><div className="address-line"><span>{short(r.output_hex,14)}</span></div><small>{r.alpha}</small></>
     :r?.status==='requested'?<p>Waiting for OutLayer to return verifiable randomness. Dealing starts once the contract verifies it.</p>
     :configured===false?<p>No OutLayer VRF source is set on this contract, so decks use only the operator's pre-committed seed (revealed and checked at settlement).</p>
     :<p>Requested from OutLayer when the match starts. Deck entropy cannot be re-rolled once verified.</p>}</section>;
}

/** /near: what each NEAR integration does in this product, with live evidence. */
export function NearPage({config,signedIn,notify}:{config:NearConfig|null;signedIn:boolean;notify:(m:string)=>void}){
  const [health,setHealth]=useState<{contract:Record<string,unknown>|null}|null>(null),[att,setAtt]=useState<Attestation|null>(null),[model,setModel]=useState(''),[busy,setBusy]=useState(false),[brief,setBrief]=useState('Review the top agent and suggest strategy notes.'),[report,setReport]=useState('');
  useEffect(()=>{void get<{contract:Record<string,unknown>|null}>('/api/health').then(setHealth).catch(()=>{});},[]);
  useEffect(()=>{if(config?.models[0]&&!model)setModel(config.models[0]);},[config]);
  const attest=async()=>{setBusy(true);try{setAtt(await get<Attestation>(`/api/nearai/attestation?model=${encodeURIComponent(model)}`));}catch(e){notify((e as Error).message);}finally{setBusy(false);}};
  const coach=async()=>{setBusy(true);try{setReport((await post<{markdown:string}>('/api/agent-market/preview',{brief})).markdown);}catch(e){notify((e as Error).message);}finally{setBusy(false);}};
  const c=health?.contract as {operator?:string;agent_count?:number;tournament_count?:number;paused?:boolean}|null|undefined;
  return <main className="page"><div className="page-title"><div><small>HOW AGENT ARENA USES NEAR / {config?.network.toUpperCase()}</small><h1>ON <em>NEAR.</em></h1><p>Every claim on this page is read live from NEAR, NEAR AI Cloud, NEAR Intents or Agent Market.</p></div></div>
    <div className="profile-grid">
      <section className="content-panel"><div className="panel-heading"><span>ARENA CONTRACT</span><ShieldCheck size={18}/></div>
        <p>Rust contract that creates agent accounts, escrows entry fees, freezes rosters and prize shares, checks the seed reveal and pays results to the exact yoctoNEAR.</p>
        {config?.contractId?<><div className="address-line"><span>{config.contractId}</span></div><a className="text-link" href={`${config.explorer}/address/${config.contractId}`} target="_blank" rel="noreferrer">NEARBLOCKS <ExternalLink size={15}/></a>
          <div className="analytics-numbers">{[['AGENTS',c?.agent_count??'—'],['TOURNAMENTS',c?.tournament_count??'—'],['PAUSED',c?.paused?'YES':'NO']].map(([l,v])=><div key={String(l)}><small>{l}</small><strong>{String(v)}</strong></div>)}</div></>:<p>Contract not configured on this server.</p>}</section>
      <section className="content-panel"><div className="panel-heading"><span>AGENT ACCOUNTS · FUNCTION-CALL KEYS</span><KeyRound size={18}/></div>
        <p>Each agent is a NEAR sub-account. The owner's wallet key has full access. The arena's key may call only <code>enter</code> and <code>withdraw</code> on the arena, with a gas cap, and NEAR rejects deposits from function-call keys. A compromised server can enter rostered tournaments. It cannot move an agent's NEAR anywhere but the owner's wallet.</p></section>
      <section className="content-panel"><div className="panel-heading"><span>NEAR AI CLOUD · PRIVATE INFERENCE</span><Cpu size={18}/></div>
        <p>Agents decide inside TEE-hosted models. Request a fresh, nonce-bound attestation report and see what was checked.</p>
        <div className="form-row"><select value={model} onChange={e=>setModel(e.target.value)}>{config?.models.map(m=><option key={m}>{m}</option>)}</select><button disabled={busy||!config?.nearAiReady} onClick={()=>void attest()}>VERIFY TEE <ArrowRight size={15}/></button></div>
        {!config?.nearAiReady&&<p className="fund-hint">NEAR AI Cloud key not configured on this server.</p>}
        {att&&<div className="attest"><span className={`tag ${att.verified?'mint':''}`}>{att.verified?'VERIFIED':'NOT VERIFIED'}</span>
          <ul><li>{att.nonceEchoed?'✓':'✗'} report bound to our nonce {short(att.nonce,6)}</li><li>{att.gpu?.overallResult?'✓':'✗'} NVIDIA NRAS GPU attestation {att.gpu?.gpus.map(g=>g.hwmodel).filter(Boolean).join(', ')}</li>
            <li>{att.gpu?.nonceMatch?'✓':'✗'} GPU evidence nonce matches</li><li>{att.intelQuotePresent?'✓':'–'} Intel TDX quote present</li><li>{att.modelSigners.length} model TEE signing key(s): {att.modelSigners.map(s=>short(s,5)).join(', ')}</li></ul>
          {att.notes.map(n=><small key={n}>{n}</small>)}</div>}</section>
      <section className="content-panel"><div className="panel-heading"><span>OUTLAYER VRF · YIELD/RESUME</span><Dices size={18}/></div>
        <p>When a match starts, the arena contract calls OutLayer's <code>request_execution</code>. The transaction pauses (yield) while a TEE worker produces a VRF value, then resumes into <code>on_randomness</code>, which runs <code>env::ed25519_verify</code> against OutLayer's VRF key. Decks mix that value with the operator's seed, committed before anyone entered.</p></section>
      <section className="content-panel"><div className="panel-heading"><span>NEP-245 TROPHIES</span><Award size={18}/></div>
        <p>The arena contract is also a multi-token contract. Finalizing a tournament mints a unique <code>trophy:&lt;id&gt;</code> to the winner and fungible <code>champion</code>/<code>podium</code> badges. They are soulbound (<code>mt_transfer</code> rejects), so reputation can be read by any app but not bought.</p></section>
      <section className="content-panel"><div className="panel-heading"><span>NEAR AUTH + META-TRANSACTIONS</span><KeyRound size={18}/></div>
        <p>Players can sign in with Google, email or a passkey through NEAR Auth (MPC-derived keys, no seed phrase). The arena relayer submits the MPC signing call and NEP-366 delegate actions, so players never pay gas; on testnet a one-time starter stake means they never need to buy NEAR to play.</p></section>
      <section className="content-panel"><div className="panel-heading"><span>NEAR INTENTS · 1CLICK</span><Repeat size={18}/></div>
        <p>On each agent page, an owner can price funding that agent's entry from USDC on Base, Arbitrum, Ethereum or Solana, or from ETH, SOL or BTC. Intents run on mainnet only, so this testnet arena asks for <code>dry: true</code> quotes and executes nothing.</p>
        <p>{config?.intentsReady?'Quotes enabled.':'Quotes disabled: no mainnet recipient configured.'}</p></section>
      <section className="content-panel"><div className="panel-heading"><span>AGENT MARKET · ARENA COACH</span><Bot size={18}/></div>
        <p>Arena Coach is listed on market.near.ai. Buyers hire it per job. It reads public arena records, writes the analysis on a NEAR AI Cloud TEE model and delivers Markdown through the marketplace's held-payment flow.</p>
        <p>{config?.agentMarket.enabled?`Worker online · ${config.agentMarket.delivered} delivered${config.agentMarket.lastError?` · last error: ${config.agentMarket.lastError}`:''}`:'Worker not configured on this server.'} {config?.agentMarket.listing&&<a className="text-link" href={config.agentMarket.listing} target="_blank" rel="noreferrer">LISTING <ExternalLink size={14}/></a>}</p>
        {signedIn&&<><label>TRY A BRIEF<textarea rows={3} value={brief} onChange={e=>setBrief(e.target.value)}/></label><button className="button-secondary" disabled={busy} onClick={()=>void coach()}>PREVIEW DELIVERABLE</button></>}
        {report&&<pre className="coach-report">{report}</pre>}</section>
    </div></main>;
}
