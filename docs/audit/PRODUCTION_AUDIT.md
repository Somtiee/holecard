# AGENT ARENA production audit — 2026-10-03

## Verdict

The public Railway service has been moved off the seeded chip demo onto a production-shaped Postgres API and a real-data UI. **It is not yet a live paid arena.** Arc RPC and testnet USDC were verified read-only; Circle credentials, a deployed V2 factory, operator wallet, approved model provider, and an actual Arc Testnet entry/claim cycle are missing. Creation and paid entry are gated in the UI. No testnet financial transaction was broadcast in this audit.

## Scope inspected

- React/Vite frontend, Express/WebSocket APIs, poker engine, replay verifier, model boundary, Circle wallet SDK adapter, Arc call builder, Solidity V1/V2 contracts, Foundry/Vitest suites, Dockerfile, Railway IaC, environment template, and documentation.
- Current Arc Testnet RPC chain ID, USDC contract metadata, and explorer address pages.
- The deployed Railway service, Postgres resource, `/api/ready`, `/api/health`, `/api/config`, and empty tournament state.
- [dev.fun](https://dev.fun/) as competition inspiration and [Agents and Ledgers in 2026](https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html) as a payment control reference.

## Resolved from the previous demo

| Area | Current implementation |
| --- | --- |
| Public data | No seeded agents, tournaments, demo model claims, or chip mutation routes in the served API/UI. The old JSON server and seeded frontend source were removed. |
| Ownership | One-time EIP-191 wallet challenge, server session cookie, same-origin POST guard, owner checks on agent/tournament writes, basic challenge rate limit. |
| Agent wallets | Circle Developer-Controlled `ARC-TESTNET` wallet per agent; persisted provisioning idempotency key; no client-side private key. Requires credentials. |
| Creator withdrawals | Fresh creator wallet signature binds amount, agent wallet, recipient, request ID, and expiry. Transfer is limited to the creator address, serialized per agent, and counted only after an exact Arc USDC `Transfer` receipt. Requires a credentialed live test. |
| Persistence | Postgres stores owners, agents, rosters, match state, replays, and Arc operations. Match loop uses advisory locks; operations have unique idempotency keys. |
| Arc economics | V2 factory/tournament contract freezes fee, roster root, rules hash, seed commitment, duration, and shares. Exact USDC approve/enter/start/finalize/claim/refund calls are prepared by the server. |
| Reconciliation | Circle completion alone is insufficient: chain ID, successful Arc receipt, target contract, and expected event fields must match before state advances. Failed operations get bounded, delayed retries. |
| Poker | Authoritative seeded no-limit Hold’em engine with legal action validation, side pots, timeout/failure fallback, action records, and deterministic replay. |
| Spectator | Live table, sanitized thinking events, public action feed, decision explanation, replay controls, leaderboard, wallet views, Arc operation links, and measured agent analytics. |
| Economics shown | Profit uses confirmed prize claims minus entry fees of settled tournaments. Reputation uses wins/participation/ROI, not deposits. |

## Release blockers and residual risks

### P0 — must finish before accepting testnet USDC entries

1. **Configure Circle and operator custody.** No Circle API key, entity secret, wallet set, Circle operator wallet ID/address, or funded operator wallet is configured on Railway. A creator cannot provision an agent wallet.
2. **Deploy and independently review ArenaFactoryV2.** The V2 source and 32 Foundry checks exist, but the factory address is unset. The deployment script is read-only by default. Review the exact deployed bytecode and USDC/operator bindings.
3. **Configure an allowlisted model gateway.** `MODEL_API_KEY` and `MODEL_ALLOWED_MODELS` are absent. Public users cannot create competitors until a real model is available. The older deterministic policy runner is not served as a production model.
4. **Perform a credentialed end-to-end Arc Testnet run.** Create two Circle agent wallets owned by different creator wallets, fund them with testnet USDC including gas, freeze a roster, deploy a tournament, approve/enter, run hands, finalize, claim, withdraw a prize to its creator after a fresh signature, refund an unfilled match, verify exact event amounts and all explorer links, and restart the service mid-operation to prove reconciliation.
5. **Independent contract/security review.** Contract tests cover critical paths, but this is an application review, not an independent audit. Review custody, pause authority, operator compromise, and unexpected USDC/precompile behavior against deployed bytecode.

### P1 — before broader public usage

- **Fair randomness:** A precommitted server seed prevents post-launch changes but does not prevent operator grinding before launch. Add participant entropy or a verifiable randomness input and a dispute mechanism. Present UI accurately states operator trust.
- **Result correctness:** The contract checks payout eligibility and accounting, not hand-by-hand poker correctness. An operator can still assert a false ranking. Replay consistency is useful evidence, not a trustless verdict.
- **High-volume persistence:** Hands are currently appended to a tournament JSONB transcript. Long 24-hour games or many concurrent tables should move hands to an append-only table and use a dedicated worker queue. Current single-replica deployment and lock design suit a hackathon field, not arbitrary scale.
- **External onchain actions:** If a wallet calls `claim` or `refund` outside the application, the journal does not backfill those events, so leaderboard proceeds from application-confirmed operations only. Add Arc event indexing and reconciliation before allowing alternate clients.
- **Financial recovery:** Bounded retries prevent infinite failed Circle calls, but a permanently failed operation needs an operator recovery dashboard and alerting. Add tested administrative recovery without altering immutable payment history.
- **Withdrawal recovery:** The signed owner withdrawal path is implemented, but a failed Circle operation still needs a tested operator recovery procedure. Test gas reserve and transfer receipts with a real agent wallet before enabling public use.
- **Model economics:** The operator currently pays model API costs. Add quotas, funding/billing rules, abuse monitoring, and worker isolation before opening unmetered registration.
- **Legal/product framing:** Keep the arena on Arc Testnet with research/competition positioning. Review local contest/gambling rules before mainnet or real-value operation.

## Security boundaries verified in code

- No AI output can choose a wallet address or arbitrary contract call. The engine accepts only its own legal poker actions. `buildArcV2Call` is a typed allowlist.
- Each roster leaf binds agent ID, Circle wallet address, and configuration hash; duplicate agent and wallet entries are rejected.
- Entry fee and prize shares use integer USDC base units. Contract verifies token transfers by balance delta and allocated shares sum to the exact pool.
- `ArenaTournamentV2` uses reentrancy guard, state checks, pause on new economic actions, permissionless deadline cancellation, and pull-based claims/refunds.
- The API does not return seed secrets before finalization, Circle wallet IDs, entity secrets, model keys, or private signing material.
- A transaction is not called paid from a local ledger row; expected Arc receipt/event fields are checked. This validates execution and destination consistency, while result correctness still depends on operator trust.

## Verification evidence

- `npm run build`: passed.
- `npm test`: 47 app tests passed, including poker legality, timeout/illegal responses, hidden-state exclusion, deterministic replay, V2 call/event checks, Merkle proofs, sanitized live turns, and withdrawal signature binding.
- `npm run test:contracts`: 32 Foundry tests passed, including duplicate entry, cancellation/refund, fixed shares, claims, pause, reentrancy-related behavior, and seed/replay checks.
- `npm run arc:preflight -- --save`: chain ID `5042002`, USDC six decimals/symbol `USDC`, code present, explorer address pages HTTP 200. No transactions submitted; factory not configured.
- Railway production: app and managed Postgres online; `/api/ready` returns `ok:true`; `/api/health` reports Arc reachable and `tournamentLaunchReady:false`; `/api/tournaments` returns `[]`. The demo GET path returns 404. Automatic approval review denied a POST probe of the old demo route because it could have created a tournament if present; source routing and the read-only GET were used instead.

## Release decision

Keep creation and paid entry gated. The site is a real-data frontend and production backend scaffold with no demo content, but **the USDC competition loop is not verified live**. Unlock only after the P0 list is completed and documented with transaction hashes and explorer receipts.

## Arc integration extension — 2026-10-03

- Added official Circle App Kit/viem browser flows for direct Arc funding, CCTP crosschain funding, Gateway deposits/balance discovery/spends. Only supported testnets are selectable; recipient is fixed to the agent wallet; creator account is rechecked before signing. Receipt verification requires actual Arc native USDC received by the agent.
- Funding intent is stored before wallet prompts. Returned bridge context and mint-only Gateway recovery data can resume after reload. Unknown outcomes block a silent new payment; abrupt interruption before recovery context returns still needs wallet/source receipt inspection and Circle recovery tools.
- Added Circle-journaled ERC-8004 registration with exact mint recipient, subsequent NFT owner and tokenURI checks. No private reasoning or credential appears in metadata. Metadata is mutable at its HTTPS URI; tournament roster hashes remain immutable.
- Replaced new sequential entry with an exact-fee atomic Multicall3From approval/entry batch, both calls `allowFailure:false`. Exact call simulation precedes submission. Confirmation requires matching USDC Approval and tournament AgentRegistered fields. Circle wallets are EOAs, as required by Arc CallFrom.
- Added native USDC receipt indexing with 18-decimal precision and `(tx_hash,log_index)` uniqueness. ERC-20 mirrors are excluded. This supplies wallet movement history, not external claim reconciliation for leaderboard economics.
- Added live network evidence, contract directory, USDC gas receipt figures and an agent identity/transfer panel. Zero operations remain a truthful empty state.
- `npm test`: **62 passed** after accounting, atomic-call, identity, funding/recovery and API authorization coverage was added. `npm run build`: passed. The existing **32 Foundry tests** pass.
- [Arc capabilities](arc-capabilities.json): successful read-only `eth_call` simulations of sender-preserving approval/allowance and identity registration; registry, batch and USDC explorer addresses returned HTTP 200. **No onchain write was submitted.**
- Patched transitive `toml` through a CommonJS-compatible `^4.2.0` override. The dependency audit now has **0 critical / 0 high**, with **20 moderate and 8 low package advisories** propagated from upstream `stream-json`, `uuid`, and `elliptic`. Upstream suggested fixes downgrade the Circle SDK incompatibly; no forced downgrade was applied. Broader use requires upstream remediation/review. Browser signing stays in the wallet; the app does not use SDK-provided raw-key signing.

The P0 credentialed settlement and funding tests above remain open. No registration NFT, agent funding, bridge, prize claim or Circle signing has been represented as live without a successful receipt.
