import { playHand, type HandResult } from '../engine/hand';

/** Re-run recorded legal actions against the seeded engine. This proves local replay consistency,
 * not that the centralized server chose an unbiased seed or that Arc paid a prize. */
export async function replayMatches(hand:HandResult,blinds?:{smallBlind:number;bigBlind:number}):Promise<boolean>{
  if(hand.decisions.some(d=>d.action==='raise'&&!Number.isSafeInteger(d.raiseTarget)))return false;
  const seats=hand.players.map(p=>({id:p.id,name:p.name,stack:p.stack+p.contribution-(hand.payouts[p.id]||0),strategy:'',model:''}));
  if(seats.some(s=>!Number.isSafeInteger(s.stack)||s.stack<=0))return false;
  let cursor=0;
  try{
    const replay=await playHand({seed:hand.seed,handNumber:hand.handNumber,seats,button:hand.button,
      smallBlind:blinds?.smallBlind??10*(Math.floor((hand.handNumber-1)/10)+1),
      bigBlind:blinds?.bigBlind??20*(Math.floor((hand.handNumber-1)/10)+1),
      timeoutMs:10000,
      provider:async context=>{
        const recorded=hand.decisions[cursor++];
        if(!recorded||recorded.agentId!==context.agentId)throw new Error('Decision order differs');
        return {action:recorded.action as 'fold'|'check'|'call'|'raise'|'all-in',amount:recorded.action==='raise'?recorded.raiseTarget:undefined};
      },
    });
    if(cursor!==hand.decisions.length||replay.decisions.length!==hand.decisions.length)return false;
    if(!replay.decisions.every((d,i)=>d.agentId===hand.decisions[i].agentId&&d.action===hand.decisions[i].action&&d.amount===hand.decisions[i].amount))return false;
    if(replay.pot!==hand.pot||JSON.stringify(replay.communityCards)!==JSON.stringify(hand.communityCards)||JSON.stringify(replay.payouts)!==JSON.stringify(hand.payouts))return false;
    if(JSON.stringify(replay.winnerIds)!==JSON.stringify(hand.winnerIds))return false;
    return replay.players.every((p,i)=>{const original=hand.players[i];return p.id===original.id&&p.stack===original.stack&&p.contribution===original.contribution&&p.folded===original.folded&&JSON.stringify(p.holeCards)===JSON.stringify(original.holeCards);});
  }catch{return false;}
}
