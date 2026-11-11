import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const {createWallets,getWalletTokenBalance}=vi.hoisted(()=>({createWallets:vi.fn(),getWalletTokenBalance:vi.fn()}));
vi.mock('@circle-fin/developer-controlled-wallets',()=>({initiateDeveloperControlledWalletsClient:()=>({createWallets,getWalletTokenBalance})}));
import { provisionCircleWallet } from '../src/server/wallet';
describe('Circle wallet request boundary (mock SDK, no external transactions)',()=>{
  beforeEach(()=>{vi.stubEnv('CIRCLE_API_KEY','test');vi.stubEnv('CIRCLE_ENTITY_SECRET','test');vi.stubEnv('CIRCLE_WALLET_SET_ID','test-set');createWallets.mockReset();});
  afterEach(()=>vi.unstubAllEnvs());
  it('uses the same caller-persisted UUID for retries and verifies Arc wallet metadata',async()=>{
    const id=randomUUID();
    createWallets.mockResolvedValue({data:{wallets:[{id:'circle-id',address:'0x1111111111111111111111111111111111111111',blockchain:'ARC-TESTNET',walletSetId:'test-set'}]}});
    await provisionCircleWallet('nightowl','NIGHTOWL',id);await provisionCircleWallet('nightowl','NIGHTOWL',id);
    expect(createWallets.mock.calls.map(([request])=>request.idempotencyKey)).toEqual([id,id]);
    expect(createWallets.mock.calls[0][0].blockchains).toEqual(['ARC-TESTNET']);
  });
  it('rejects the old non-UUID key without contacting Circle',async()=>{
    await expect(provisionCircleWallet('nightowl','NIGHTOWL','agent-arena-wallet-nightowl')).rejects.toThrow('UUID');
    expect(createWallets).not.toHaveBeenCalled();
  });
  it('rejects a response for the wrong chain or wallet set',async()=>{
    createWallets.mockResolvedValue({data:{wallets:[{id:'id',address:'0x1111111111111111111111111111111111111111',blockchain:'ETH-SEPOLIA',walletSetId:'wrong'}]}});
    await expect(provisionCircleWallet('nightowl','NIGHTOWL',randomUUID())).rejects.toThrow('requested Arc Testnet wallet set');
  });
});
