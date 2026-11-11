import {describe,it,expect} from 'vitest';
import {decodeFunctionData,encodeAbiParameters,encodeEventTopics,erc20Abi,type Address,type Hex,formatUnits} from 'viem';
import {buildArcV2Call,batchFromAbi,identityAbi,extractIdentityToken,hasExpectedArcEvent,tournamentV2Abi} from '../src/server/circleArc';
import {nativeTransfers} from '../src/server/production/arcEvents';
import {ARC_USDC,ARC_SYSTEM_USDC,ARC_IDENTITY_REGISTRY,ARC_MULTICALL_FROM,arcTransactionUrl} from '../src/shared/arc';
import {validateFundingPlan,safeExplorer,type FundingPlan} from '../src/ui/funding/plan';
const wallet='0x0000000000000000000000000000000000000011' as Address,tournament='0x0000000000000000000000000000000000000022' as Address;
const id=`0x${'12'.repeat(32)}` as Hex,agentId=`0x${'34'.repeat(32)}` as Hex,configHash=`0x${'56'.repeat(32)}` as Hex;
function transfer(address:Address,amount:bigint){return{address,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:wallet,to:tournament}}),data:encodeAbiParameters([{type:'uint256'}],[amount]),logIndex:1};}
describe('Arc native USDC accounting',()=>{
  it('counts only the 18-decimal system event, not the 6-decimal ERC20 mirror',()=>{const result=nativeTransfers([transfer(ARC_SYSTEM_USDC,10n**18n),transfer(ARC_USDC,10n**6n)]);expect(result).toHaveLength(1);expect(formatUnits(result[0].amountNative,18)).toBe('1');});
  it('retains precision below an ERC20 micro-unit',()=>expect(nativeTransfers([transfer(ARC_SYSTEM_USDC,1n)])[0].amountNative).toBe(1n));
  it('ignores malformed, unmined and zero-value logs',()=>expect(nativeTransfers([{...transfer(ARC_SYSTEM_USDC,1n),data:'0x'},{...transfer(ARC_SYSTEM_USDC,1n),logIndex:null},transfer(ARC_SYSTEM_USDC,0n)])).toEqual([]));
  it('does not manufacture explorer links from invalid hashes',()=>{expect(arcTransactionUrl('fake')).toBeNull();expect(arcTransactionUrl(id)).toContain(`/tx/${id}`);});
});
describe('Arc sender-preserving atomic entry',()=>{
  it('encodes approval and entry as two non-optional calls',()=>{const built=buildArcV2Call({kind:'atomic-entry',usdc:ARC_USDC,tournament,agentId,configHash,amountMicroUsdc:123n,proof:[]});expect(built.contractAddress).toBe(ARC_MULTICALL_FROM);const calls=decodeFunctionData({abi:batchFromAbi,data:built.callData}).args[0];expect(calls).toHaveLength(2);expect(calls.every(c=>!c.allowFailure)).toBe(true);expect(calls[0].target.toLowerCase()).toBe(ARC_USDC);expect(decodeFunctionData({abi:erc20Abi,data:calls[0].callData}).args).toEqual([tournament,123n]);expect(decodeFunctionData({abi:tournamentV2Abi,data:calls[1].callData}).args).toEqual([agentId,configHash,[]]);});
  it('requires exact approval and roster event from their own contracts',()=>{
    const logs=[{address:ARC_USDC,topics:encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:wallet,spender:tournament}}),data:encodeAbiParameters([{type:'uint256'}],[123n])},{address:tournament,topics:encodeEventTopics({abi:tournamentV2Abi,eventName:'AgentRegistered',args:{tournamentId:id,agentId,wallet}}),data:encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[configHash,123n])}];
    const expected={kind:'atomic-entry' as const,usdc:ARC_USDC,tournament,tournamentId:id,agentId,wallet,configHash,amountMicroUsdc:123n};
    expect(hasExpectedArcEvent(logs,ARC_MULTICALL_FROM,expected)).toBe(true);
    expect(hasExpectedArcEvent(logs.slice(1),ARC_MULTICALL_FROM,expected)).toBe(false);
    expect(hasExpectedArcEvent(logs,ARC_MULTICALL_FROM,{...expected,amountMicroUsdc:124n})).toBe(false);
    expect(hasExpectedArcEvent(logs,ARC_MULTICALL_FROM,{...expected,configHash:id})).toBe(false);
    expect(hasExpectedArcEvent(logs,ARC_USDC,expected)).toBe(false);
  });
});
describe('ERC8004 identity receipt',()=>{
  const mint={address:ARC_IDENTITY_REGISTRY,data:'0x' as Hex,topics:encodeEventTopics({abi:identityAbi,eventName:'Transfer',args:{from:'0x0000000000000000000000000000000000000000',to:wallet,tokenId:0n}})};
  it('recognizes token zero and binds the mint to the agent wallet',()=>{expect(extractIdentityToken([mint],wallet)).toBe(0n);expect(extractIdentityToken([mint],tournament)).toBeNull();});
  it('rejects counterfeit registry logs and non-mint transfers',()=>{expect(extractIdentityToken([{...mint,address:tournament}],wallet)).toBeNull();expect(extractIdentityToken([{...mint,topics:encodeEventTopics({abi:identityAbi,eventName:'Transfer',args:{from:tournament,to:wallet,tokenId:1n}})}],wallet)).toBeNull();});
  it('restricts registration to the official registry and HTTPS metadata',()=>{expect(()=>buildArcV2Call({kind:'identity',registry:tournament,metadataUri:'https://example.com'})).toThrow();expect(()=>buildArcV2Call({kind:'identity',registry:ARC_IDENTITY_REGISTRY,metadataUri:'http://example.com'})).toThrow();});
});
describe('creator funding boundaries',()=>{
  const plan:FundingPlan={mode:'bridge',source:'Base_Sepolia',amount:'1.123456',recipient:tournament,owner:wallet};
  it('allows exact micro-USDC and rejects rounding and invalid amounts',()=>{expect(validateFundingPlan(plan)).toEqual(plan);for(const amount of ['0','-1','1.1234567','1e3','NaN','01'])expect(()=>validateFundingPlan({...plan,amount})).toThrow();});
  it('blocks mainnet routes and incorrect direct-send chains',()=>{expect(()=>validateFundingPlan({...plan,source:'Ethereum' as never})).toThrow();expect(()=>validateFundingPlan({...plan,mode:'send'})).toThrow();expect(()=>validateFundingPlan({...plan,source:'Arc_Testnet'})).toThrow();});
  it('rejects zero-address destinations and untrusted explorer links',()=>{expect(()=>validateFundingPlan({...plan,recipient:'0x0000000000000000000000000000000000000000'})).toThrow();expect(safeExplorer('javascript:alert(1)')).toBeUndefined();expect(safeExplorer('https://evil.example/tx/123')).toBeUndefined();expect(safeExplorer(`https://explorer.testnet.arc.io/tx/${id}`)).toContain('/tx/');});
});

describe('funding recovery',()=>{
  it('retains exact SDK bigint recovery data and binds it to owner and recipient',async()=>{
    const {serializeRecovery,parseRecovery}=await import('../src/ui/funding/recovery');
    const record={version:1 as const,plan:{mode:'spend' as const,source:'Arc_Testnet' as const,amount:'1',recipient:tournament,owner:wallet},mint:{attestation:'0x1234',signature:'0xabcd'}};
    expect(parseRecovery(serializeRecovery(record),wallet,tournament)).toEqual(record);
    expect(()=>parseRecovery(serializeRecovery(record),tournament,wallet)).toThrow('different wallet');
  });
  it('extracts only Gateway mint-retry attestations from structured errors',async()=>{
    const {mintRecovery}=await import('../src/ui/funding/recovery');
    expect(mintRecovery(new Error('network timeout'))).toBeNull();
    expect(mintRecovery({cause:{trace:{attestation:'0x12',signature:'0x34',privateKey:'never retain'}}})).toEqual({attestation:'0x12',signature:'0x34'});
    expect(mintRecovery({cause:{trace:{attestation:'bad',signature:'0x34'}}})).toBeNull();
  });
});
