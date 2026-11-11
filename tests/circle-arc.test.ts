import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hex } from 'viem';
import { buildArcV2Call, factoryV2Abi, hasExpectedArcEvent, tournamentV2Abi } from '../src/server/circleArc';

const factory='0x00000000000000000000000000000000000000a1' as Address;
const tournament='0x00000000000000000000000000000000000000b2' as Address;
const wallet='0x00000000000000000000000000000000000000c3' as Address;
const id=`0x${'11'.repeat(32)}` as Hex;
const agentId=`0x${'22'.repeat(32)}` as Hex;
const configHash=`0x${'33'.repeat(32)}` as Hex;

describe('Circle Arc call boundary',()=>{
  it('encodes an allowlisted entry call and rejects invalid identifiers',()=>{
    expect(buildArcV2Call({kind:'enter',tournament,agentId,configHash,proof:[]}).contractAddress).toBe(tournament);
    expect(()=>buildArcV2Call({kind:'enter',tournament,agentId:'0x01',configHash,proof:[]})).toThrow('Invalid bytes32');
    expect(()=>buildArcV2Call({kind:'approve',usdc:factory,tournament,amountMicroUsdc:0n})).toThrow('positive');
  });
  it('requires the exact registered wallet and agent in a confirmed Arc event',()=>{
    const topics=encodeEventTopics({abi:tournamentV2Abi,eventName:'AgentRegistered',args:{tournamentId:id,agentId,wallet}});
    const data=encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[configHash,10_000_000n]);
    const logs=[{address:tournament,data,topics}];
    expect(hasExpectedArcEvent(logs,tournament,{kind:'registered',tournamentId:id,agentId,wallet})).toBe(true);
    expect(hasExpectedArcEvent(logs,tournament,{kind:'registered',tournamentId:id,agentId,wallet:factory})).toBe(false);
    expect(hasExpectedArcEvent(logs,factory,{kind:'registered',tournamentId:id,agentId,wallet})).toBe(false);
  });
  it('recognizes a factory creation only from the configured factory',()=>{
    const topics=encodeEventTopics({abi:factoryV2Abi,eventName:'TournamentCreated',args:{tournamentId:id,tournament}});
    const data=encodeAbiParameters([{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'uint256'},{type:'uint256'}],[configHash,configHash,configHash,10_000_000n,2n]);
    expect(hasExpectedArcEvent([{address:factory,data,topics}],factory,{kind:'created',tournamentId:id})).toBe(true);
  });
  it('checks the exact approval spender and amount before entry',()=>{
    const topics=encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:wallet,spender:tournament}});
    const data=encodeAbiParameters([{type:'uint256'}],[10_000_000n]);
    const logs=[{address:factory,data,topics}];
    expect(hasExpectedArcEvent(logs,factory,{kind:'approval',owner:wallet,spender:tournament,amountMicroUsdc:10_000_000n})).toBe(true);
    expect(hasExpectedArcEvent(logs,factory,{kind:'approval',owner:wallet,spender:tournament,amountMicroUsdc:20_000_000n})).toBe(false);
  });
  it('requires the exact prize wallet and USDC micro amount',()=>{
    const topics=encodeEventTopics({abi:tournamentV2Abi,eventName:'PrizePaid',args:{tournamentId:id,wallet}});
    const data=encodeAbiParameters([{type:'uint256'}],[7_500_000n]);
    const logs=[{address:tournament,data,topics}];
    expect(hasExpectedArcEvent(logs,tournament,{kind:'paid',tournamentId:id,wallet,amountMicroUsdc:7_500_000n})).toBe(true);
    expect(hasExpectedArcEvent(logs,tournament,{kind:'paid',tournamentId:id,wallet,amountMicroUsdc:7_500_001n})).toBe(false);
    expect(hasExpectedArcEvent(logs,tournament,{kind:'paid',tournamentId:id,wallet:factory,amountMicroUsdc:7_500_000n})).toBe(false);
  });
  it('encodes cancellation and refund without a model-controlled destination',()=>{
    expect(buildArcV2Call({kind:'cancelIfUnfilled',tournament}).contractAddress).toBe(tournament);
    expect(buildArcV2Call({kind:'cancelExpired',tournament}).contractAddress).toBe(tournament);
    expect(buildArcV2Call({kind:'refund',tournament}).contractAddress).toBe(tournament);
    const topics=encodeEventTopics({abi:tournamentV2Abi,eventName:'TournamentCancelled',args:{tournamentId:id}});
    expect(hasExpectedArcEvent([{address:tournament,data:'0x' as Hex,topics}],tournament,{kind:'cancelled',tournamentId:id})).toBe(true);
  });
  it('binds a wallet withdrawal to one recipient and exact USDC amount',()=>{
    const call=buildArcV2Call({kind:'withdraw',usdc:factory,recipient:wallet,amountMicroUsdc:2_500_000n});
    expect(call.contractAddress).toBe(factory);
    expect(()=>buildArcV2Call({kind:'withdraw',usdc:factory,recipient:wallet,amountMicroUsdc:0n})).toThrow('positive');
    const topics=encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:tournament,to:wallet}});
    const data=encodeAbiParameters([{type:'uint256'}],[2_500_000n]);
    const logs=[{address:factory,data,topics}];
    expect(hasExpectedArcEvent(logs,factory,{kind:'transfer',sender:tournament,recipient:wallet,amountMicroUsdc:2_500_000n})).toBe(true);
    expect(hasExpectedArcEvent(logs,factory,{kind:'transfer',sender:tournament,recipient:wallet,amountMicroUsdc:2_500_001n})).toBe(false);
    expect(hasExpectedArcEvent(logs,factory,{kind:'transfer',sender:wallet,recipient:tournament,amountMicroUsdc:2_500_000n})).toBe(false);
  });
});
