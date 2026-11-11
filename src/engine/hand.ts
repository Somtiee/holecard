import {calculateSidePots,compareHands,createDeck,evaluateHand,legalActions,seededRandom,validateAction,type Decision,type Player} from './poker';

export type HandStage='preflop'|'flop'|'turn'|'river'|'showdown';
export type HandSeat={id:string;name:string;stack:number;strategy:string;model:string;description?:string};
export type HandDecision={agentId:string;agent:string;stage:HandStage;position:string;action:string;amount:number;raiseTarget?:number;pot:number;stack:number;tableStacks:Record<string,number>;latencyMs:number;reason:string;communityCards:string[];timestamp:number};
export type HandResult={seed:number|string;commitment?:string;handNumber:number;button:number;stage:HandStage;communityCards:string[];pot:number;players:Player[];payouts:Record<string,number>;decisions:HandDecision[];winnerIds:string[];startedAt:number;endedAt:number};
export type DecisionContext={agentId:string;agentName:string;model:string;strategy:string;description?:string;position:string;holeCards:string[];communityCards:string[];pot:number;stack:number;opponents:{id:string;stack:number;folded:boolean}[];legalActions:{action:string;min?:number;max?:number}[];timeoutMs:number};
export type AgentDecision=Decision & {reason?:string};
export type DecisionProvider=(context:DecisionContext)=>Promise<AgentDecision>;
export type PublicTurn={agentId:string;agent:string;stage:HandStage;position:string;communityCards:string[];pot:number;stack:number;timeoutMs:number};
const SUITS:Record<string,string>={'♠':'s','♥':'h','♦':'d','♣':'c'};
const publicCard=(card:string)=>`${card[0]}${SUITS[card[1]]}`;
const positions=['BTN','SB','BB','UTG','MP','CO'];
const timeoutFallback=(ctx:DecisionContext):AgentDecision=>ctx.legalActions.some(a=>a.action==='check')?{action:'check',reason:'Fallback: checked because no wager was required.'}:{action:'fold',reason:'Fallback: folded after the decision timeout.'};

/** Authoritative, deterministic Hold'em hand runner. Provider output can only select engine-issued legal actions. */
export async function playHand(input:{seed:number|string;handNumber:number;seats:HandSeat[];button:number;smallBlind:number;bigBlind:number;provider:DecisionProvider;timeoutMs?:number;now?:()=>number;onTurn?:(turn:PublicTurn)=>void|Promise<void>;onDecision?:(decision:HandDecision)=>void|Promise<void>}):Promise<HandResult>{
  if(input.seats.length<2||input.seats.length>9)throw new Error('A Hold’em hand requires 2–9 seats');
  if(!Number.isInteger(input.button)||input.button<0||input.button>=input.seats.length)throw new Error('Invalid dealer button');
  if(new Set(input.seats.map(s=>s.id)).size!==input.seats.length||input.seats.some(s=>!Number.isSafeInteger(s.stack)||s.stack<=0))throw new Error('Seats must have unique IDs and positive integer stacks');
  if(!Number.isSafeInteger(input.smallBlind)||!Number.isSafeInteger(input.bigBlind)||input.smallBlind<=0||input.bigBlind<input.smallBlind)throw new Error('Invalid blinds');
  const now=input.now||Date.now,startedAt=now(),deck=createDeck(input.seed);
  const players:Player[]=input.seats.map(s=>({id:s.id,name:s.name,stack:s.stack,contribution:0,folded:s.stack<=0,holeCards:[]}));
  const profile=new Map(input.seats.map(s=>[s.id,s]));
  const communityCards:string[]=[],streetBets=new Map(players.map(p=>[p.id,0])),decisions:HandDecision[]=[];
  const active=()=>players.filter(p=>!p.folded);
  const take=()=>deck.pop()!;
  for(let round=0;round<2;round++)for(let i=0;i<players.length;i++){const p=players[(input.button+i)%players.length];if(!p.folded)p.holeCards.push(take());}
  const smallIndex=players.length===2?input.button:(input.button+1)%players.length;
  const bigIndex=(smallIndex+1)%players.length;
  const postBlind=(i:number,amount:number)=>{const p=players[i];const paid=Math.min(p.stack,amount);p.stack-=paid;p.contribution+=paid;streetBets.set(p.id,paid);};
  postBlind(smallIndex,input.smallBlind);postBlind(bigIndex,input.bigBlind);
  let stage:HandStage='preflop',currentBet=Math.max(...streetBets.values()),minRaise=input.bigBlind;
  let actorIndex=players.length===2?smallIndex:(bigIndex+1)%players.length;
  let guard=0;
  while(active().length>1){
    if(++guard>500)throw new Error('Hand action limit exceeded');
    const pending=new Set(active().filter(p=>p.stack>0).map(p=>p.id));
    const actedAtBet=new Map<string,number>();
    if(stage==='preflop'){
      // Blinds are live; the big blind still gets an option if nobody raises.
    }
    while(pending.size&&active().length>1){
      let p:Player|undefined;
      for(let n=0;n<players.length;n++){const candidate=players[(actorIndex+n)%players.length];if(pending.has(candidate.id)){p=candidate;actorIndex=(actorIndex+n+1)%players.length;break;}}
      if(!p)break;
      const streetBet=streetBets.get(p.id)||0;
      const otherCanBet=active().some(other=>other.id!==p!.id&&other.stack>0);
      if(!otherCanBet&&streetBet>=currentBet){pending.delete(p.id);continue;}
      const temp:Player={...p,contribution:streetBet};
      const canRaise=otherCanBet&&(!actedAtBet.has(p.id)||currentBet-actedAtBet.get(p.id)!>=minRaise);
      const actions=legalActions(temp,currentBet,minRaise,canRaise);
      const seat=profile.get(p.id)!;
      const context:DecisionContext={agentId:p.id,agentName:p.name,model:seat.model,strategy:seat.strategy,description:seat.description,position:positions[(players.indexOf(p)-input.button+players.length)%players.length]||'MP',holeCards:p.holeCards.map(publicCard),communityCards:communityCards.map(publicCard),pot:players.reduce((s,x)=>s+x.contribution,0),stack:p.stack,opponents:players.filter(x=>x.id!==p.id).map(x=>({id:x.id,stack:x.stack,folded:x.folded})),legalActions:actions,timeoutMs:input.timeoutMs??4000};
      try{await input.onTurn?.({agentId:p.id,agent:p.name,stage,position:context.position,communityCards:context.communityCards,pot:context.pot,stack:context.stack,timeoutMs:context.timeoutMs});}catch{/* spectator delivery cannot stop a hand */}
      const started=now();let response:AgentDecision;
      try{response=await withTimeout(input.provider(context),context.timeoutMs);}catch{response=timeoutFallback(context);}
      let accepted:Decision;let failed=false;
      try{accepted=validateAction(temp,currentBet,response,minRaise,canRaise);}catch{failed=true;response=timeoutFallback(context);accepted=validateAction(temp,currentBet,response,minRaise,canRaise);}
      const previousStack=p.stack,previousBet=streetBet;
      if(accepted.action==='fold')p.folded=true;
      else if(accepted.action==='call'||accepted.action==='raise'||accepted.action==='all-in'){
        const target=accepted.action==='raise'?accepted.amount!:accepted.action==='all-in'?streetBet+Math.min(p.stack,accepted.amount!):streetBet+accepted.amount!;
        const spent=Math.min(p.stack,Math.max(0,target-streetBet));p.stack-=spent;p.contribution+=spent;streetBets.set(p.id,streetBet+spent);
      }
      const updatedBet=streetBets.get(p.id)||0;
      pending.delete(p.id);
      if(updatedBet>currentBet){const raiseBy=updatedBet-currentBet;currentBet=updatedBet;if(raiseBy>=minRaise)minRaise=raiseBy;for(const other of active())if(other.id!==p.id&&other.stack>0)pending.add(other.id);}
      actedAtBet.set(p.id,currentBet);
      const elapsed=Math.max(0,now()-started);
      // Explanations are engine-owned public metadata. Model prose could reveal private cards.
      const decision:HandDecision={agentId:p.id,agent:p.name,stage,position:context.position,action:accepted.action,amount:previousStack-p.stack,raiseTarget:accepted.action==='raise'?accepted.amount:undefined,pot:players.reduce((s,x)=>s+x.contribution,0),stack:p.stack,tableStacks:Object.fromEntries(players.map(x=>[x.id,x.stack])),latencyMs:elapsed,reason:failed?'Fallback: invalid action; checked if legal, otherwise folded.':defaultReason(accepted.action,context),communityCards:communityCards.map(publicCard),timestamp:now()};decisions.push(decision);await input.onDecision?.(decision);
      if(previousStack===p.stack&&previousBet===(streetBets.get(p.id)||0)&&accepted.action!=='check'&&accepted.action!=='fold')throw new Error('Action failed to change game state');
    }
    if(active().length<=1)break;
    if(stage==='preflop'){communityCards.push(take(),take(),take());stage='flop';}
    else if(stage==='flop'){communityCards.push(take());stage='turn';}
    else if(stage==='turn'){communityCards.push(take());stage='river';}
    else {stage='showdown';break;}
    currentBet=0;minRaise=input.bigBlind;for(const p of players)streetBets.set(p.id,0);
    actorIndex=(input.button+1)%players.length;
  }
  if(active().length>1){while(communityCards.length<5)communityCards.push(take());stage='showdown';}else stage='showdown';
  const pots=calculateSidePots(players),payouts:Record<string,number>={};for(const p of players)payouts[p.id]=0;
  for(const pot of pots){const eligible=players.filter(p=>pot.eligible.includes(p.id));if(!eligible.length)throw new Error('Pot has no eligible players');if(eligible.length===1){payouts[eligible[0].id]+=pot.amount;continue;}let best:number[]|undefined,winners:Player[]=[];for(const p of eligible){const score=evaluateHand([...p.holeCards,...communityCards]);const compare=best?compareHands(score,best):1;if(compare>0){best=score;winners=[p]}else if(compare===0)winners.push(p);}winners.sort((a,b)=>a.id.localeCompare(b.id));const each=Math.floor(pot.amount/winners.length),extra=pot.amount%winners.length;winners.forEach((p,i)=>payouts[p.id]+=each+(i<extra?1:0));}
  for(const p of players)p.stack+=payouts[p.id];
  const winnerIds=players.filter(p=>payouts[p.id]>0).map(p=>p.id);
  const revealShowdown=active().length>1;
  return{seed:input.seed,handNumber:input.handNumber,button:input.button,stage,communityCards:communityCards.map(publicCard),pot:players.reduce((s,p)=>s+p.contribution,0),players:players.map(p=>({...p,holeCards:revealShowdown&&!p.folded?p.holeCards.map(publicCard):[]})),payouts,decisions,winnerIds,startedAt,endedAt:now()};
}
function defaultReason(action:string,context:DecisionContext){if(action==='fold')return'Folded to conserve the remaining bankroll.';if(action==='check')return'Checked with no wager to call.';if(action==='call')return'Called within the configured strategy.';if(action==='raise')return'Raised within the legal range returned by the game engine.';return'Committed the remaining stack.';}

/** A bounded, deterministic policy used by engine tests; production always calls an approved model. */
export async function fixtureDecision(context:DecisionContext):Promise<AgentDecision>{
  const ranks=context.holeCards.map(c=>'23456789TJQKA'.indexOf(c[0]));
  const high=Math.max(...ranks),pair=ranks[0]===ranks[1];
  const publicState=`${context.agentId}|${context.holeCards.join('')}|${context.communityCards.join('')}|${context.pot}|${context.stack}`;
  const publicSeed=[...publicState].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261);
  const roll=seededRandom(publicSeed)();
  const strategy=context.strategy.toLowerCase();
  const aggressive=strategy.includes('aggressive'),conservative=strategy.includes('conservative'),bluff=strategy.includes('bluff'),math=strategy.includes('mathematical');
  const raise=context.legalActions.find(a=>a.action==='raise');
  const call=context.legalActions.find(a=>a.action==='call');
  const inPosition=['BTN','CO'].includes(context.position);
  const strong=pair&&high>=7||high>=11;
  const playable=pair&&high>=4||high>=9||math&&high>=7;
  const callLimit=conservative?.04:aggressive?.16:math?.1:.08;
  const affordable=Boolean(call)&&call!.max!<=Math.max(1,Math.floor(context.stack*callLimit),math?Math.floor(context.pot*.25):0);
  const bluffSpot=bluff&&inPosition&&roll>.54||aggressive&&inPosition&&roll>.82;
  if(raise&&!conservative&&(strong&&roll>.27||bluffSpot))return{action:'raise',amount:raise.min};
  if(raise&&conservative&&pair&&high>=11&&roll>.55)return{action:'raise',amount:raise.min};
  if(context.legalActions.some(a=>a.action==='check'))return{action:'check'};
  if(call&&playable&&affordable)return{action:'call'};
  return{action:'fold'};
}

function withTimeout<T>(work:Promise<T>,ms:number):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('DECISION_TIMEOUT')),ms);work.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});});}
