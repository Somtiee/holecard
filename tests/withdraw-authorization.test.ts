import {describe,expect,it} from 'vitest';
import {verifyMessage} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {withdrawalAuthorizationMessage} from '../src/server/production/arena';

describe('agent wallet withdrawal authorization',()=>{
  it('binds the creator signature to amount, recipient, wallet, request and expiration',async()=>{
    const account=privateKeyToAccount(`0x${'42'.repeat(32)}`);
    const input={owner:account.address,agentId:'00000000-0000-4000-8000-000000000001',wallet:'0x00000000000000000000000000000000000000a1',amountUsdc:'2.50',requestId:'00000000-0000-4000-8000-000000000002',expiresAt:'2026-10-03T10:00:00.000Z'};
    const message=withdrawalAuthorizationMessage(input);
    const signature=await account.signMessage({message});
    expect(await verifyMessage({address:account.address,message,signature})).toBe(true);
    for(const change of [{amountUsdc:'2.51'},{owner:'0x00000000000000000000000000000000000000b2'},{wallet:'0x00000000000000000000000000000000000000b2'},{requestId:'00000000-0000-4000-8000-000000000003'},{expiresAt:'2026-10-03T10:01:00.000Z'}]){
      const altered=withdrawalAuthorizationMessage({...input,...change});
      expect(await verifyMessage({address:account.address,message:altered,signature})).toBe(false);
    }
  });
});
