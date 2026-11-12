import { createHash, randomBytes } from 'node:crypto';
import { recoverMessageAddress, type Hex } from 'viem';
import type { AgentDecision, DecisionContext } from '../../engine/hand';

/** NEAR AI Cloud private inference. Every agent decision (which includes the agent's private hole
 * cards) is sent only to a TEE-hosted model through the NEAR AI Cloud gateway. For each completion
 * we keep the exact request/response hashes and later check the TEE signature over them against the
 * signing addresses from a fresh, nonce-bound attestation report. Prompts are never stored. */
export const NEARAI_BASE_URL = (process.env.NEARAI_BASE_URL || 'https://cloud-api.near.ai').replace(/\/$/, '');
const apiKey = () => {
  const v = process.env.NEARAI_API_KEY;
  if (!v) throw new Error('NEARAI_API_KEY is not configured');
  return v;
};
export const allowedModels = () =>
  (process.env.NEARAI_MODELS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
export const nearAiConfigured = () => Boolean(process.env.NEARAI_API_KEY && allowedModels().length);
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export type TeeReceipt = { agentId: string; model: string; chatId: string; requestHash: string; responseHash: string };

const SYSTEM =
  'You are a Texas Hold’em tournament agent. Return only JSON {"action": one of the legal actions, "amount": number when raising}. amount for raise is the total street contribution target. Do not explain.';

export async function nearAiDecision(
  context: DecisionContext,
  onReceipt: (receipt: TeeReceipt) => void,
): Promise<AgentDecision> {
  // The exact body string is hashed; the TEE signs sha256(request body) and sha256(response body).
  const body = JSON.stringify({
    model: context.model,
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          agent: { name: context.agentName, strategy: context.strategy, strategyNotes: context.description },
          position: context.position,
          holeCards: context.holeCards,
          communityCards: context.communityCards,
          pot: context.pot,
          stack: context.stack,
          opponents: context.opponents,
          legalActions: context.legalActions,
        }),
      },
    ],
  });
  const response = await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(context.timeoutMs),
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`NEAR AI Cloud returned HTTP ${response.status}`);
  const parsed = JSON.parse(text) as { id?: string; choices?: { message?: { content?: string } }[] };
  if (parsed.id)
    onReceipt({
      agentId: context.agentId,
      model: context.model,
      chatId: parsed.id,
      requestHash: sha256(body),
      responseHash: sha256(text),
    });
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new Error('Model response had no content');
  const match = content.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[^{}]*"action"[^{}]*\}/);
  if (!match) throw new Error('Model response had no JSON action');
  const json = JSON.parse(match[0]) as { action?: string; amount?: number };
  if (!['fold', 'check', 'call', 'raise', 'all-in'].includes(json.action || ''))
    throw new Error('Model returned an unknown action');
  return {
    action: json.action as AgentDecision['action'],
    amount: typeof json.amount === 'number' ? Math.floor(json.amount) : undefined,
  };
}

// ---------- attestation ----------

type AttestationReport = {
  request_nonce?: string;
  model_attestations?: { signing_address?: string; nvidia_payload?: unknown; intel_quote?: string }[];
  gateway_attestation?: { signing_address?: string; intel_quote?: string };
};
export type AttestationSummary = {
  model: string;
  nonce: string;
  checkedAt: string;
  nonceEchoed: boolean;
  modelSigners: string[];
  gatewaySigners: string[];
  gpu: {
    overallResult: boolean;
    nonceMatch: boolean | null;
    gpus: { key: string; hwmodel: string | null; secureBoot: unknown; measurement: unknown }[];
  } | null;
  intelQuotePresent: boolean;
  verified: boolean;
  notes: string[];
};
const cache = new Map<string, { at: number; summary: AttestationSummary }>();

function decodeJwt(token: string) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<
    string,
    unknown
  >;
}

/** Fetches a report bound to a fresh random nonce and checks it the way the NEAR AI docs describe. */
export async function attestModel(model: string, force = false): Promise<AttestationSummary> {
  if (!allowedModels().includes(model)) throw new Error('Model is not on the arena allowlist');
  const hit = cache.get(model);
  if (!force && hit && Date.now() - hit.at < 10 * 60_000) return hit.summary;
  const nonce = randomBytes(32).toString('hex'),
    notes: string[] = [];
  const params = new URLSearchParams({ model, nonce, signing_algo: 'ecdsa' });
  const res = await fetch(`${NEARAI_BASE_URL}/v1/attestation/report?${params}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Attestation request failed with HTTP ${res.status}`);
  const report = (await res.json()) as AttestationReport;
  const nonceEchoed = (report.request_nonce || '').toLowerCase() === nonce;
  if (!nonceEchoed) notes.push('Report did not echo our nonce.');
  const modelSigners = [
    ...new Set((report.model_attestations || []).map(a => a.signing_address).filter(Boolean) as string[]),
  ];
  const gatewaySigners = report.gateway_attestation?.signing_address
    ? [report.gateway_attestation.signing_address]
    : [];
  let gpu: AttestationSummary['gpu'] = null;
  const payload = report.model_attestations?.find(a => a.nvidia_payload)?.nvidia_payload;
  if (payload) {
    try {
      const nras = await fetch('https://nras.attestation.nvidia.com/v3/attest/gpu', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      if (!nras.ok) throw new Error(`NVIDIA NRAS HTTP ${nras.status}`);
      const tokens = (await nras.json()) as unknown[];
      const decoded: Record<string, Record<string, unknown>> = {};
      for (const item of tokens) {
        if (Array.isArray(item) && item.length === 2) decoded[String(item[0])] = decodeJwt(String(item[1]));
        else if (item && typeof item === 'object')
          for (const [k, v] of Object.entries(item)) decoded[k] = decodeJwt(String(v));
      }
      const overall = decoded.JWT || {};
      const eat = typeof overall.eat_nonce === 'string' ? overall.eat_nonce : null;
      gpu = {
        overallResult: overall['x-nvidia-overall-att-result'] === true,
        nonceMatch: eat ? eat.toLowerCase() === nonce : null,
        gpus: Object.entries(decoded)
          .filter(([k]) => k.startsWith('GPU-'))
          .map(([key, c]) => ({
            key,
            hwmodel: (c.hwmodel as string) ?? null,
            secureBoot: c.secboot ?? null,
            measurement: c.measres ?? null,
          })),
      };
      notes.push(
        'NVIDIA NRAS JWT claims are decoded; the JWT signature itself is not checked against NVIDIA JWKS in this build.',
      );
    } catch (error) {
      notes.push(`GPU attestation check failed: ${(error as Error).message}`);
    }
  } else notes.push('No NVIDIA payload in the report.');
  const intelQuotePresent = Boolean(
    report.gateway_attestation?.intel_quote || report.model_attestations?.some(a => a.intel_quote),
  );
  const verified =
    nonceEchoed && modelSigners.length > 0 && (gpu ? gpu.overallResult && gpu.nonceMatch !== false : false);
  const summary = {
    model,
    nonce,
    checkedAt: new Date().toISOString(),
    nonceEchoed,
    modelSigners,
    gatewaySigners,
    gpu,
    intelQuotePresent,
    verified,
    notes,
  };
  cache.set(model, { at: Date.now(), summary });
  return summary;
}

/** Fetch the TEE signature for one completion and check hashes + signer against the attestation. */
export async function verifyReceipt(r: {
  model: string;
  chat_id: string;
  request_hash: string;
  response_hash: string;
}) {
  const url = `${NEARAI_BASE_URL}/v1/signature/${encodeURIComponent(r.chat_id)}?model=${encodeURIComponent(r.model)}&signing_algo=ecdsa`;
  type Sig = { text: string; signature: string; signing_address?: string; signature_kind?: string };
  let found: Sig | null = null;
  for (let i = 0; i < 4 && !found; i++) {
    const res = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) found = (await res.json()) as Sig;
    else if (res.status !== 404) throw new Error(`Signature request failed with HTTP ${res.status}`);
    else await new Promise(f => setTimeout(f, 1000));
  }
  const sig = found;
  if (!sig) return { verified: false, kind: null, signer: null, detail: 'Signature not available yet' };
  const parts = sig.text.split(':');
  const kind = sig.signature_kind || (parts.length === 3 ? 'provider_tee' : 'gateway');
  if (parts.length !== (kind === 'provider_tee' ? 3 : 2))
    return { verified: false, kind, signer: null, detail: 'Signature kind does not match signed text' };
  if (kind === 'provider_tee' && parts[0] !== r.model)
    return { verified: false, kind, signer: null, detail: 'Signed model id differs' };
  const [reqHash, resHash] = parts.slice(-2);
  if (reqHash !== r.request_hash || resHash !== r.response_hash)
    return { verified: false, kind, signer: null, detail: 'Signed hashes do not match the exchanged bytes' };
  const signer = await recoverMessageAddress({ message: sig.text, signature: sig.signature as Hex });
  const attestation = await attestModel(r.model);
  const expected = (kind === 'gateway' ? attestation.gatewaySigners : attestation.modelSigners).map(a =>
    a.toLowerCase(),
  );
  const ok = expected.includes(signer.toLowerCase());
  return {
    verified: ok,
    kind,
    signer,
    detail: ok ? 'Signer matches an attested TEE key' : 'Signer is not in the attested key set',
  };
}
