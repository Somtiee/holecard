export const ELO_START=1200;
/** Skill rating independent of stake size: each settled finish is scored as pairwise Elo games between every two
 * entrants (higher finish wins), with K split across opponents so a 9-seat table moves ratings as much as a duel. */
export function eloRatings(rankings:string[][],k=32){
  const rating=new Map<string,number>();
  for(const ranking of rankings){
    if(ranking.length<2)continue;
    const before=ranking.map(id=>rating.get(id)??ELO_START),scale=k/(ranking.length-1);
    ranking.forEach((id,i)=>{let delta=0;ranking.forEach((_,j)=>{if(i===j)return;const expected=1/(1+10**((before[j]-before[i])/400));delta+=scale*((i<j?1:0)-expected);});rating.set(id,before[i]+delta);});
  }
  return new Map([...rating].map(([id,r])=>[id,Math.round(r)]));
}
