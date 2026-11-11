import { createHash } from 'node:crypto';
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in';
export type Player = { id: string; name: string; stack: number; contribution: number; folded: boolean; holeCards: string[] };
export type LegalAction = { action: ActionType; min?: number; max?: number };
export type Decision = { action: ActionType; amount?: number };
export type SidePot = { amount: number; eligible: string[] };

// Mulberry32 is intentionally deterministic; the seed is public only after a match ends.
export function seededRandom(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function createDeck(seed: number|string) {
  const cards = ['♠','♥','♦','♣'].flatMap(s => Array.from({length:13},(_,i)=>`${'23456789TJQKA'[i]}${s}`));
  // Numeric seeds are accepted for deterministic unit tests. Server hands use a 256-bit seed.
  const legacy=typeof seed==='number'?seededRandom(seed):null;
  if(!legacy&&!/^[a-f0-9]{64}$/i.test(String(seed)))throw new Error('Expected a 256-bit hexadecimal seed');
  let counter=0,offset=32,block=Buffer.alloc(32);
  const nextWord=()=>{if(offset===32){block=createHash('sha256').update(`arena-deck-v1:${seed}:${counter++}`).digest();offset=0;}const word=block.readUInt32BE(offset);offset+=4;return word;};
  for(let i=cards.length-1;i>0;i--){
    const size=i+1,limit=2**32-(2**32%size);let j:number;
    if(legacy)j=Math.floor(legacy()*size);
    else{let word;do{word=nextWord();}while(word>=limit);j=word%size;}
    [cards[i],cards[j]]=[cards[j],cards[i]];
  }
  return cards;
}
export function createTable(names: string[], seed: number, startingStack=1000) { const deck=createDeck(seed); const players=names.map((name,i)=>({id:`agent-${i+1}`,name,stack:startingStack,contribution:0,folded:false,holeCards:[deck.pop()!,deck.pop()!]})); return {seed,deck,players,communityCards:[] as string[],pot:0,highestBet:0}; }
export function legalActions(player: Player, highestBet: number, minRaise = 1, canRaise=true): LegalAction[] {
  if(player.folded||player.stack<=0)return[];
  const due=Math.max(0,highestBet-player.contribution),maximum=player.contribution+player.stack;
  const actions:LegalAction[]=[{action:'fold'}];
  if(due===0)actions.push({action:'check'});else actions.push({action:'call',max:Math.min(due,player.stack)});
  if(canRaise&&player.stack>due&&maximum>=highestBet+minRaise)actions.push({action:'raise',min:highestBet+minRaise,max:maximum});
  if(canRaise||player.stack<=due)actions.push({action:'all-in',max:player.stack});
  return actions;
}
export function validateAction(player: Player, highestBet: number, decision: Decision, minRaise = 1, canRaise=true): Decision {
  if(!decision||typeof decision!=='object')throw new Error('Invalid agent response');
  const legal=legalActions(player,highestBet,minRaise,canRaise),allowed=legal.find(x=>x.action===decision.action);
  if(!allowed)throw new Error(`Illegal action: ${decision.action}`);
  if(decision.action==='raise'){if(!Number.isSafeInteger(decision.amount)||decision.amount!<allowed.min!||decision.amount!>allowed.max!)throw new Error('Raise amount is outside the legal range');return{action:'raise',amount:decision.amount};}
  if(decision.action==='all-in')return{action:'all-in',amount:player.stack};
  return{action:decision.action,amount:decision.action==='call'?allowed.max:0};
}
export function executeAction(player: Player, highestBet: number, decision: Decision, minRaise = 1) { const valid=validateAction(player,highestBet,decision,minRaise); if(valid.action==='fold')player.folded=true; if(valid.action==='call'){player.stack-=valid.amount!;player.contribution+=valid.amount!;} if(valid.action==='raise'){const amount=valid.amount!-player.contribution; player.stack-=amount;player.contribution=valid.amount!;} if(valid.action==='all-in'){player.stack=0;player.contribution+=valid.amount!;} return valid; }
export function calculateSidePots(players: Player[]): SidePot[] { const levels=[...new Set(players.map(p=>p.contribution).filter(x=>x>0))].sort((a,b)=>a-b); let prior=0; return levels.map(level=>{const contributors=players.filter(p=>p.contribution>=level);const amount=(level-prior)*contributors.length;prior=level;return {amount,eligible:contributors.filter(p=>!p.folded).map(p=>p.id)};}); }
const rank:Record<string,number>={2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,T:10,J:11,Q:12,K:13,A:14};
function evaluateFive(cards:string[]):number[]{const values=cards.map(c=>rank[c[0]]).sort((a,b)=>b-a);const suits=cards.map(c=>c[1]);const counts=new Map<number,number>();values.forEach(v=>counts.set(v,(counts.get(v)||0)+1));const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const flush=suits.every(s=>s===suits[0]);const uniq=[...new Set(values)];let straight=0;for(let i=0;i<=uniq.length-5;i++)if(uniq[i]-uniq[i+4]===4)straight=uniq[i];if(uniq.includes(14)&&uniq.includes(2)&&uniq.includes(3)&&uniq.includes(4)&&uniq.includes(5))straight=5;if(flush&&straight)return[8,straight];if(groups[0][1]===4)return[7,groups[0][0],groups[1][0]];if(groups[0][1]===3&&groups[1][1]===2)return[6,groups[0][0],groups[1][0]];if(flush)return[5,...values];if(straight)return[4,straight];if(groups[0][1]===3)return[3,groups[0][0],...groups.slice(1).map(g=>g[0])];if(groups[0][1]===2&&groups[1][1]===2)return[2,Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]];if(groups[0][1]===2)return[1,groups[0][0],...groups.slice(1).map(g=>g[0])];return[0,...values];}
export function evaluateHand(cards:string[]):number[]{if(cards.length<5||cards.length>7)throw new Error('A Hold’em hand must contain 5–7 cards');let best=[-1];for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){const score=evaluateFive([cards[a],cards[b],cards[c],cards[d],cards[e]]);if(compareHands(score,best)>0)best=score;}return best;}
export function compareHands(a:number[],b:number[]){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;}
export function showdown(players:Player[],communityCards:string[]){const eligible=players.filter(p=>!p.folded);if(eligible.length===1)return[{playerId:eligible[0].id,score:[9]}];return eligible.map(p=>({playerId:p.id,score:evaluateHand([...p.holeCards,...communityCards])})).sort((a,b)=>compareHands(b.score,a.score));}

/** Resolve each contribution tier independently, including ties, without creating or losing chips. */
export function settleSidePots(players: Player[], communityCards: string[]): Record<string, number> {
  const payouts:Record<string,number>={};
  for(const player of players)payouts[player.id]=0;
  for(const pot of calculateSidePots(players)){
    const contenders=players.filter(p=>pot.eligible.includes(p.id));
    if(!contenders.length)throw new Error('Side pot has no eligible player');
    if(contenders.length===1){payouts[contenders[0].id]+=pot.amount;continue;}
    const ranked=contenders.map(p=>({id:p.id,score:evaluateHand([...p.holeCards,...communityCards])}));
    let best=ranked[0].score;
    for(const hand of ranked.slice(1))if(compareHands(hand.score,best)>0)best=hand.score;
    const winners=ranked.filter(hand=>compareHands(hand.score,best)===0).map(hand=>hand.id).sort();
    const share=Math.floor(pot.amount/winners.length),remainder=pot.amount%winners.length;
    winners.forEach((id,index)=>payouts[id]+=share+(index<remainder?1:0));
  }
  return payouts;
}
