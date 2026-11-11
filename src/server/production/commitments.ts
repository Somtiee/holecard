import {createHmac,randomBytes} from 'node:crypto';
import {encodeAbiParameters,keccak256,stringToHex,type Address,type Hex} from 'viem';

export type RosterSeat={agentId:string;wallet:Address;configHash:Hex};
const bytes32=(value:string):Hex=>keccak256(stringToHex(value));
export const chainTournamentId=(id:string)=>bytes32(`agent-arena:tournament:${id}`);
export const chainAgentId=(id:string)=>bytes32(`agent-arena:agent:${id}`);
export const configHash=(agent:{id:string;owner:string;walletAddress:string;name:string;strategy:string;model:string;description:string})=>
  bytes32(JSON.stringify({id:agent.id,owner:agent.owner,wallet:agent.walletAddress.toLowerCase(),name:agent.name,strategy:agent.strategy,model:agent.model,description:agent.description}));
export function newSeed(){const seed=`0x${randomBytes(32).toString('hex')}` as Hex;return{seed,commitment:keccak256(seed)};}
export function handSeed(seed:Hex,tournamentId:string,handNumber:number){return createHmac('sha256',Buffer.from(seed.slice(2),'hex')).update(`${tournamentId}:${handNumber}`).digest('hex');}
const pair=(left:Hex,right:Hex)=>keccak256(left.toLowerCase()<right.toLowerCase()?`${left}${right.slice(2)}` as Hex:`${right}${left.slice(2)}` as Hex);
export function rosterCommitment(seats:RosterSeat[]){
  if(seats.length<2||seats.length>9)throw new Error('Roster must contain 2–9 seats');
  if(new Set(seats.map(s=>s.agentId)).size!==seats.length||new Set(seats.map(s=>s.wallet.toLowerCase())).size!==seats.length)throw new Error('Duplicate roster agent or wallet');
  const leaves=seats.map(s=>keccak256(encodeAbiParameters([{type:'bytes32'},{type:'address'},{type:'bytes32'}],[chainAgentId(s.agentId),s.wallet,s.configHash])));
  const layers:Hex[][]=[leaves];
  while(layers.at(-1)!.length>1){const level=layers.at(-1)!;const next:Hex[]=[];for(let i=0;i<level.length;i+=2)next.push(i+1<level.length?pair(level[i],level[i+1]):level[i]);layers.push(next);}
  const proofs=seats.map((_,index)=>{const siblings:Hex[]=[];let n=index;for(let i=0;i<layers.length-1;i++){const sibling=n^1;if(sibling<layers[i].length)siblings.push(layers[i][sibling]);n=Math.floor(n/2);}return siblings;});
  return{root:layers.at(-1)![0],proofs,leaves};
}
export function rulesHash(rules:{id:string;entryMicro:string;startingStack:number;capacity:number;durationSeconds:number;shares:number[]}){return bytes32(JSON.stringify(rules));}
export function resultCommitment(input:unknown){return bytes32(JSON.stringify(input));}
