/** Checks the NEAR AI Cloud setup without starting the arena: key works, each allowlisted model answers a
 * poker decision, attestation is fresh and nonce-bound, and the TEE signature over the exchange verifies.
 * Usage: node --import tsx scripts/check-nearai.ts   (reads NEARAI_API_KEY / NEARAI_MODELS from .env) */
import '../src/server/env';
import {
  allowedModels,
  attestModel,
  nearAiConfigured,
  nearAiDecision,
  verifyReceipt,
  type TeeReceipt,
} from '../src/server/near/nearai';

if (!nearAiConfigured()) throw new Error('NEARAI_API_KEY or NEARAI_MODELS is not set');
const sleep = (ms: number) => new Promise(f => setTimeout(f, ms));
for (const model of allowedModels()) {
  const row: Record<string, unknown> = { model };
  try {
    const a = await attestModel(model, true);
    Object.assign(row, {
      attested: a.verified,
      nonceEchoed: a.nonceEchoed,
      gpu: a.gpu?.overallResult ?? null,
      signers: a.modelSigners.length,
      notes: a.notes.length,
    });
    const receipts: TeeReceipt[] = [];
    const started = Date.now();
    const decision = await nearAiDecision(
      {
        agentId: 'check',
        agentName: 'CHECK',
        model,
        strategy: 'Balanced',
        description: '',
        position: 'BTN',
        holeCards: ['Ah', 'Kh'],
        communityCards: [],
        pot: 30,
        stack: 980,
        opponents: [{ id: 'x', stack: 990, folded: false }],
        legalActions: [
          { action: 'fold' },
          { action: 'call', min: 10, max: 10 },
          { action: 'raise', min: 40, max: 980 },
        ],
        timeoutMs: 30000,
      } as never,
      r => receipts.push(r),
    );
    Object.assign(row, {
      decision: `${decision.action}${decision.amount ? ` ${decision.amount}` : ''}`,
      ms: Date.now() - started,
    });
    if (receipts[0]) {
      let v: { signatureChecked: boolean; detail: string; kind?: string | null } = {
        signatureChecked: false,
        detail: 'Signature not available yet',
      };
      for (let i = 0; i < 5; i++) {
        v = await verifyReceipt({
          model,
          chat_id: receipts[0].chatId,
          request_hash: receipts[0].requestHash,
          response_hash: receipts[0].responseHash,
        });
        if (v.signatureChecked || !/not available/i.test(v.detail)) break;
        await sleep(3000);
      }
      Object.assign(row, { receipt: v.signatureChecked ? `SIGNATURE MATCHED (${v.kind})` : v.detail });
    }
  } catch (error) {
    row.error = (error as Error).message.slice(0, 200);
  }
  console.log(JSON.stringify(row));
}
