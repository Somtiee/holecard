import {describe,expect,it} from 'vitest';
import {encodeAbiParameters,keccak256,type Address,type Hex} from 'viem';
import {chainAgentId,chainTournamentId,configHash,handSeed,newSeed,rosterCommitment,rulesHash} from '../src/server/production/commitments';

const wallets=[1,2,3,4,5,6,7,8,9].map(n=>`0x${n.toString(16).padStart(40,'0')}` as Address);
const seats=(count:number)=>wallets.slice(0,count).map((wallet,i)=>({agentId:`agent-${i}`,wallet,configHash:keccak256(`0x${(i+1).toString(16).padStart(2,'0')}`) as Hex}));
const pair=(a:Hex,b:Hex)=>keccak256(a.toLowerCase()<b.toLowerCase()?`${a}${b.slice(2)}` as Hex:`${b}${a.slice(2)}` as Hex);

describe('production Arc commitments',()=>{
  it('produces V2-compatible Merkle proofs for every roster size, including odd layers',()=>{
    for(let count=2;count<=9;count++){
      const roster=seats(count),commit=rosterCommitment(roster);
      for(let i=0;i<count;i++){
        let node=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'address'},{type:'bytes32'}],[chainAgentId(roster[i].agentId),roster[i].wallet,roster[i].configHash]));
        for(const sibling of commit.proofs[i])node=pair(node,sibling);
        expect(node).toBe(commit.root);
      }
    }
  });
  it('binds wallet, agent and config and rejects duplicate identities',()=>{
    const first=seats(3),root=rosterCommitment(first).root;
    expect(rosterCommitment([{...first[0],wallet:wallets[8]},...first.slice(1)]).root).not.toBe(root);
    expect(rosterCommitment([{...first[0],configHash:keccak256('0xff')},...first.slice(1)]).root).not.toBe(root);
    expect(()=>rosterCommitment([first[0],{...first[1],wallet:first[0].wallet}])).toThrow('Duplicate');
    expect(()=>rosterCommitment([first[0],{...first[1],agentId:first[0].agentId}])).toThrow('Duplicate');
  });
  it('commits a seed before play and derives stable, distinct hand seeds',()=>{
    const {seed,commitment}=newSeed();expect(keccak256(seed)).toBe(commitment);
    expect(handSeed(seed,'tournament',1)).toBe(handSeed(seed,'tournament',1));
    expect(handSeed(seed,'tournament',2)).not.toBe(handSeed(seed,'tournament',1));
    expect(handSeed(seed,'other',1)).not.toBe(handSeed(seed,'tournament',1));
  });
  it('produces different chain IDs and config hashes for changed economics or models',()=>{
    expect(chainTournamentId('t1')).not.toBe(chainTournamentId('t2'));
    expect(chainAgentId('a1')).not.toBe(chainTournamentId('a1'));
    const agent={id:'a',owner:wallets[0],walletAddress:wallets[1],name:'ALPHA',strategy:'Adaptive',model:'model-1',description:'patient'};
    expect(configHash(agent)).not.toBe(configHash({...agent,model:'model-2'}));
    const rules={id:'x',entryMicro:'1000000',startingStack:1000,capacity:2,durationSeconds:300,shares:[10000]};
    expect(rulesHash(rules)).not.toBe(rulesHash({...rules,entryMicro:'2000000'}));
  });
});
