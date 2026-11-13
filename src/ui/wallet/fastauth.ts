/** NEAR Auth (FastAuth) sign-in: Google, Apple, email or passkey through Auth0, with the user's NEAR key
 * derived by the MPC network. No wallet, seed phrase or NEAR is needed.
 *
 * The published FastAuth SDK signs NEAR transactions but not NEP-413 messages, so sign-in is proven with a
 * transaction that can never execute (nonce 0, zero block hash, a zero-gas call carrying the server's
 * single-use challenge). Redirect flow, because popups are blocked after async work:
 *   1. startNearAuth(): NEAR Auth login → back here
 *   2. resumeNearAuth() stage "login": build the sign-in transaction for the derived key and ask the user to
 *      approve it on NEAR Auth → back here
 *   3. resumeNearAuth() stage "sign": the arena relayer submits the MPC `sign` call and pays the gas; the
 *      recovered ed25519 signature goes to the server, which checks it against the derived key (server/near/fastauth.ts).
 * The account is the implicit account (hex of the derived key). Loaded lazily: only this path pulls the SDK. */
export type FastAuthConfig = {
  ready: boolean;
  contractId: string;
  mpcContractId: string;
  clientId: string;
  domain: string;
  signingAudience: string | null;
  signInReceiver: string | null;
};
const SIGN_IN_METHOD = 'holecard_sign_in';
const STAGE = 'arena.nearauth.stage',
  CHALLENGE = 'arena.nearauth.challenge',
  TX = 'arena.nearauth.tx',
  KEY = 'arena.nearauth.key',
  RETURN = 'arena.nearauth.return';

const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
  del: (...keys: string[]) => {
    for (const k of keys)
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* storage blocked */
      }
  },
};
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d as T;
}
const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const toHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
// The app uses hash routes, so NEAR Auth always returns to "<origin>/"; the server allowlist check uses the same URL.
const redirectUri = () => `${location.origin}${location.pathname}`;
// Auth0 returns with ?code=&state=; once the SDK has exchanged them, drop them so a reload cannot replay them.
const dropAuthParams = () => {
  if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
};

type Sdk = { client: any; provider: any; v5: any };
let sdkPromise: Promise<Sdk> | null = null;
function load(cfg: FastAuthConfig) {
  if (!sdkPromise)
    sdkPromise = (async () => {
      // The NEAR Auth SDK (near-api-js v5) expects Node's Buffer in the browser.
      const { Buffer } = await import('buffer');
      (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
      const [{ FastAuthClient }, { JavascriptProvider }, v5] = await Promise.all([
        import('@fast-auth-near/browser-sdk'),
        import('@fast-auth-near/javascript-provider'),
        import('near-api-js-v5'),
      ]);
      const provider = new JavascriptProvider({
        network: 'testnet',
        clientId: cfg.clientId,
        domain: cfg.domain,
        ...(cfg.signingAudience ? { signingAudience: cfg.signingAudience } : {}),
      } as any);
      const { connection } = await v5.connect({ networkId: 'testnet', nodeUrl: 'https://rpc.testnet.near.org' });
      return {
        provider,
        v5,
        client: new FastAuthClient(provider as any, connection as any, {
          fastAuthContractId: cfg.contractId,
          mpcContractId: cfg.mpcContractId,
        }),
      };
    })().catch(error => {
      sdkPromise = null;
      throw error;
    });
  return sdkPromise;
}

/** Step 1. Leaves the page for the NEAR Auth login. */
export async function startNearAuth(cfg: FastAuthConfig) {
  if (!cfg.ready || !cfg.signInReceiver) throw new Error('NEAR Auth sign-in is not available on this domain yet.');
  const { client } = await load(cfg);
  store.del(CHALLENGE, TX, KEY);
  store.set(STAGE, 'login');
  store.set(RETURN, location.hash || '#/');
  await client.login({ redirectUri: redirectUri() });
}

/** Call on every page load. Returns the signed-in account when the flow completes, otherwise null. */
export async function resumeNearAuth(cfg: FastAuthConfig): Promise<{ accountId: string } | null> {
  const stage = store.get(STAGE);
  if (!stage) return null;
  try {
    const { client, provider, v5 } = await load(cfg);
    const loggedIn = await provider.isLoggedIn();
    dropAuthParams();
    if (!loggedIn) throw new Error('NEAR Auth login was not completed.');
    const signer = await client.getSigner();

    if (stage === 'login') {
      if (!cfg.signInReceiver) throw new Error('The arena contract is not configured.');
      // The MPC view returns the derived key as "ed25519:<base58>"; the implicit account is its hex.
      const derived = await signer.getPublicKey('ed25519');
      const publicKey = v5.utils.PublicKey.fromString(String(derived));
      const accountId = toHex(new Uint8Array(publicKey.data));
      const challenge = await post<{ recipient: string; nonce: string }>('/api/auth/challenge', {});
      const args = new TextEncoder().encode(JSON.stringify({ recipient: challenge.recipient, nonce: challenge.nonce }));
      const transaction = v5.transactions.createTransaction(
        accountId,
        publicKey,
        cfg.signInReceiver,
        0n,
        [v5.transactions.functionCall(SIGN_IN_METHOD, args, 0n, 0n)],
        new Uint8Array(32),
      );
      store.set(CHALLENGE, challenge.nonce);
      store.set(KEY, publicKey.toString());
      store.set(TX, toBase64(v5.transactions.encodeTransaction(transaction)));
      store.set(STAGE, 'sign');
      await signer.requestTransactionSignature({ transaction, redirectUri: redirectUri() });
      return null;
    }

    const nonce = store.get(CHALLENGE),
      tx = store.get(TX),
      publicKey = store.get(KEY);
    if (!nonce || !tx || !publicKey) throw new Error('Sign-in challenge was lost; please try again.');
    const { signatureRequest } = await signer.getSignatureRequest();
    const action = await signer.createSignAction(signatureRequest, { gas: 300000000000000n, deposit: 1n });
    const call = action.functionCall;
    if (!call || call.methodName !== 'sign') throw new Error('NEAR Auth returned an unexpected action');
    const relayed = await post<{ successValue: string | null }>('/api/relay/fastauth-sign', {
      methodName: call.methodName,
      argsBase64: toBase64(new Uint8Array(call.args)),
      gas: String(call.gas),
      deposit: String(call.deposit),
    });
    if (!relayed.successValue) throw new Error('NEAR Auth did not sign the sign-in request');
    const { FastAuthSignature } = await import('@fast-auth-near/browser-sdk');
    const signature: Uint8Array = FastAuthSignature.fromBase64(relayed.successValue).recover('ed25519');
    const accountId = toHex(new Uint8Array(v5.utils.PublicKey.fromString(publicKey).data));
    const session = await post<{ accountId: string }>('/api/auth/verify-fastauth', {
      accountId,
      publicKey,
      transaction: tx,
      signature: toBase64(new Uint8Array(signature)),
      nonce,
    });
    const back = store.get(RETURN);
    store.del(STAGE, CHALLENGE, TX, KEY, RETURN);
    history.replaceState(null, '', `${location.pathname}${back || '#/'}`);
    return session;
  } catch (error) {
    store.del(STAGE, CHALLENGE, TX, KEY);
    dropAuthParams();
    throw error;
  }
}
export async function signOutNearAuth() {
  if (!sdkPromise) return;
  try {
    // Clear the NEAR Auth session locally without navigating to Auth0's logout page.
    await (await sdkPromise).client.logout({ openUrl: false });
  } catch {
    /* not logged in */
  }
}
