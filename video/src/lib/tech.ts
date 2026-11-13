/** Section 5 of docs/demo-video-prompt.md, checked against the code (see docs/demo-video-plan.md). */
export type TechKey =
  | 'connect'
  | 'nep413'
  | 'auth'
  | 'subaccounts'
  | 'fckeys'
  | 'contract'
  | 'nep366'
  | 'intents'
  | 'nearai'
  | 'vrf'
  | 'settle'
  | 'nep245';

export type Tech = { n: number; tag: string; short: string; what: string; does: string; proof: string };

export const TECH: Record<TechKey, Tech> = {
  connect: {
    n: 1,
    tag: 'NEAR · NEAR Connect',
    short: 'one picker for every NEAR wallet',
    what: "NEAR's wallet connector.",
    does: "One picker for Meteor, Intear, Nightly, Ledger and NEAR CLI, for sign-in and the owner's own deposit and withdraw.",
    proof: 'The wallet picker.',
  },
  nep413: {
    n: 2,
    tag: 'NEAR · NEP-413',
    short: 'sign a message, not a transaction',
    what: 'The NEAR standard for signing a message without sending a transaction.',
    does: "Sign-in: the server verifies the ed25519 signature and checks on-chain that the key is a full-access key of that account.",
    proof: 'The wallet asks to sign a message. No transaction, no fee.',
  },
  auth: {
    n: 3,
    tag: 'NEAR · NEAR Auth',
    short: 'email, Google or passkey, no seed phrase',
    what: "Email, Google or passkey sign-in. The user's NEAR key is derived by NEAR's MPC network, so there is no seed phrase.",
    does: 'Sign-in without a wallet; the relayer submits the MPC signing call.',
    proof: 'Local build only: the Email · Google · Passkey option.',
  },
  subaccounts: {
    n: 4,
    tag: 'NEAR · Sub-accounts',
    short: 'every agent is its own account',
    what: 'NEAR accounts can create child accounts.',
    does: 'Every agent is its own account, created by the contract. The operator pays the 0.1 NEAR account seed, never the escrow.',
    proof: 'nightowl.agent-arena-ad7b13.testnet and its account creation tx.',
  },
  fckeys: {
    n: 5,
    tag: 'NEAR · Function-call access keys',
    short: 'the server can play, never take',
    what: 'NEAR keys that can only call named methods on one contract, with a gas allowance and no deposits.',
    does: "The owner's wallet key is the only full-access key. The server's key can only call enter and withdraw, with a 0.25 NEAR gas cap, and withdraw always pays the owner.",
    proof: 'ACCESS KEYS (READ FROM CHAIN).',
  },
  contract: {
    n: 6,
    tag: 'NEAR · Rust contract · near-sdk 5',
    short: 'escrow, commitments, exact payouts',
    what: "Holecard's own contract, agent-arena-ad7b13.testnet, with 37 unit tests.",
    does: 'Escrows entry fees; freezes the roster hash, prize shares and a deck-seed commitment before play; pays to the exact yoctoNEAR.',
    proof: 'create_tournament, then each agent signing its own enter.',
  },
  nep366: {
    n: 7,
    tag: 'NEAR · NEP-366 meta-transactions',
    short: 'the user signs, the relayer pays gas',
    what: 'Delegate actions: a user signs, someone else pays the gas.',
    does: 'The Holecard relayer pays gas for deposit and withdraw, and forwards only those two calls. A testnet starter stake means no one has to buy NEAR.',
    proof: 'CLAIM 1 NEAR TESTNET STARTER STAKE.',
  },
  intents: {
    n: 8,
    tag: 'NEAR · NEAR Intents',
    short: 'price an entry from any chain',
    what: 'Cross-chain swaps settled through NEAR (1Click API).',
    does: 'Prices an entry fee from USDC on Base, Arbitrum, Ethereum or Solana, or ETH, SOL or BTC. Intents run on mainnet, so this testnet build asks for dry: true quotes and executes nothing.',
    proof: 'A live quote: 3.588677 USDC on Base → 1.0 NEAR.',
  },
  nearai: {
    n: 9,
    tag: 'NEAR AI · Cloud TEE',
    short: 'every move decided inside a TEE',
    what: 'Open models served from inside TEEs (trusted execution environments).',
    does: "Every decision is a chat completion on a TEE-hosted model. Holecard stores only sha256 hashes of the request and response and checks the enclave's signature against a fresh, nonce-bound attestation.",
    proof: 'PRIVATE INFERENCE RECEIPTS · TEE VERIFIED, then VERIFY TEE.',
  },
  vrf: {
    n: 10,
    tag: 'OutLayer · VRF · yield/resume',
    short: 'randomness the contract verifies',
    what: 'Verifiable randomness from a TEE, delivered back into the same NEAR transaction.',
    does: 'The transaction yields while OutLayer produces a VRF value, then resumes into on_randomness, which verifies the Ed25519 proof on-chain. Values can’t be re-rolled.',
    proof: 'VERIFIABLE SHUFFLE · VRF VERIFIED ONCHAIN.',
  },
  settle: {
    n: 11,
    tag: 'OutLayer · verified settlement',
    short: 'paid only after a TEE replay',
    what: "Running Holecard's own code in a TEE on the contract's behalf.",
    does: 'The replay worker re-deals every hand from inputs the contract trusts, rejects illegal actions and derives the ranking. on_settlement_checked pays only if it matches.',
    proof: 'PROOF OF RESULT and the finalize_verified transaction.',
  },
  nep245: {
    n: 12,
    tag: 'NEAR · NEP-245 multi-token',
    short: 'soulbound trophies any app can read',
    what: "NEAR's multi-token standard.",
    does: 'Settling mints a unique trophy:<tournament> to the winner plus champion and podium badges. They are soulbound: mt_transfer rejects.',
    proof: 'TROPHIES · NEP-245 (SOULBOUND).',
  },
};

export const ORDER: TechKey[] = [
  'connect',
  'nep413',
  'auth',
  'subaccounts',
  'fckeys',
  'contract',
  'nep366',
  'intents',
  'nearai',
  'vrf',
  'settle',
  'nep245',
];
