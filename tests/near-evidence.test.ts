import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyPair, KeyPairSigner, createTransaction, actions } from 'near-api-js';
import { provider, resolveCall } from '../src/server/near/chain';
import { verifyReceipt } from '../src/server/near/nearai';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('chain transaction evidence', () => {
  it('retries the identical signed bytes after an unknown outcome and checks finality', async () => {
    const signer = KeyPairSigner.fromSecretKey(KeyPair.fromRandom('ed25519').toString());
    const tx = createTransaction(
      'alice.testnet',
      await signer.getPublicKey(),
      'arena.testnet',
      23n,
      [actions.functionCall('deposit', { agent: 'agent.arena.testnet' }, 10n, 1n)],
      new Uint8Array(32),
    );
    const { signedTransaction } = await signer.signTransaction(tx);
    const bytes = Buffer.from(signedTransaction.encode()).toString('base64');
    const call = { hash: 'known-hash', sender: 'alice.testnet', bytes };
    const status = vi.spyOn(provider, 'viewTransactionStatus').mockRejectedValue(new Error('unknown'));
    const send = vi.spyOn(provider, 'sendTransactionUntil').mockRejectedValue(new Error('timeout'));
    expect(await resolveCall(call)).toEqual({ state: 'pending' });
    expect(await resolveCall(call)).toEqual({ state: 'pending' });
    expect(send.mock.calls.map(([signed]) => Buffer.from(signed.encode()).toString('base64'))).toEqual([bytes, bytes]);
    status.mockResolvedValue({
      final_execution_status: 'FINAL',
      status: { SuccessValue: 'dHJ1ZQ==' },
      transaction_outcome: { id: 'known-hash' },
    } as Awaited<ReturnType<typeof provider.viewTransactionStatus>>);
    expect(await resolveCall(call)).toEqual({ state: 'confirmed', value: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledWith({ txHash: 'known-hash', accountId: 'alice.testnet', waitUntil: 'NONE' });
  });
});

describe('inference signature evidence', () => {
  const receipt = { model: 'test/model', chat_id: 'chat', request_hash: 'request', response_hash: 'response' };

  it('rejects missing signature kind and unavailable evidence', async () => {
    vi.stubEnv('NEARAI_API_KEY', 'test');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ text: 'request:response', signature: '0x00' }))
      .mockResolvedValueOnce(Response.json({ error_code: 'not_supported' }));
    vi.stubGlobal('fetch', fetch);
    expect(await verifyReceipt(receipt)).toMatchObject({ signatureChecked: false, kind: null });
    expect(await verifyReceipt(receipt)).toMatchObject({ signatureChecked: false, kind: null });
  });
});
