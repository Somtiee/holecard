# Holecard demo video: timing plan and code check

> **Built** in `video/` (Remotion). Decision: option A (real match, LANTERN). Target: X only, so the main cut was tightened to **2:18** to fit X's 2:20 upload limit for non-Premium accounts. Final bars: cover 3 · hook 4 · practice 6 · sign-in 5 · keys 7 · fund 5 · lock 5 · shuffle 6 · private 7 · result 8 · trophies 4 · withdraw 3 · stack 3 · close 3. The table below is the original plan.

The plan for `docs/demo-video-prompt.md`, written before any animation. Main cut: 30 fps, 120 BPM (one bar = 2 s = 60 frames), 75 bars = 2:30. Every scene starts on a bar.

## 1. Where the brief disagrees with the code (the code wins)

| # | Brief says | Code / live testnet says | What the video will show |
|---|---|---|---|
| 1 | PROOF OF RESULT has five rows | `SettlementPanel` has **six**. Row 4 is `"{n} hands replay to the same result here"`; for the verified match the live API returns 15/15 hands valid | All six rows, row 4 reading **"15 hands replay to the same result here"** |
| 2 | "gas cap 0.25 NEAR" | `NearPanels.tsx` formats the allowance with three decimals: **"gas cap 0.250 NEAR"** (NIGHTOWL's live key). Keys that have spent gas show less, for example HOUSE MIRAGE's shows 0.249 | `Only enter, withdraw on agent-arena-ad7b13.testnet · gas cap 0.250 NEAR · cannot attach deposits`. Captions say "0.25 NEAR" |
| 3 | Click **RUN ALL CHECKS** after settlement | On a `settled` or `finalizing` match the panel runs by itself and the button then reads **RUN AGAIN**. RUN ALL CHECKS only shows before the first run | The checklist ticks in when the match settles, then the cursor clicks **RUN AGAIN** and the rows tick again |
| 4 | PAID BY THE CONTRACT: "HOUSE MIRAGE / HOUSE GRANITE" | The payout rows print the account prefix: **house-mirage-a66a 1.4 NEAR**, **house-granite-a66a 0.6 NEAR** | Exactly that |
| 5 | Quote "3.49 USDC on Base → 1 wNEAR" | The UI prints `{amountIn} {source}` / `≈ ${usd} → {amountOut} NEAR · ~{s}s`. Today's live dry quote: **3.588677 USDC on Base / ≈ $3.59 → 1.0 NEAR · ~37s** | The live numbers, with the word "quote" only |
| 6 | NIGHTOWL plays the verified match | The verified match `26ef5698…` is **"Opening Night"**: 0.5 NEAR entry, 4 seats, prize shares 7000/3000, pot 2 NEAR. The player's agent there was **LANTERN**, not NIGHTOWL | **Decision needed** (section 4) |
| 7 | The brief lists the wallet picker as "Meteor, Intear, Nightly, Ledger, NEAR CLI" | Matches the README. The picker is NEAR Connect's own modal (`@hot-labs/near-connect`), so its exact copy isn't in this repo. On holecard.fun, `sign_in` opens it directly because no NEAR Auth client is set there | A redraw of the picker with those five wallets. The NEAR Auth menu appears only in the "Local build" inset |
| 8 | Agent Market | `config.agentMarket.enabled` is `false` on holecard.fun | Left out of the main cut. In the stack montage it is not one of the twelve tags |

Everything else in sections 5 and 6 of the brief checks out against the code: the contract has 37 tests, the 0.1 NEAR seed, `ed25519_verify` in `on_randomness`, `mt_transfer` rejecting, the restricted key limited to `enter`/`withdraw`, `dry: true` quotes, the two models (Qwen/Qwen3.6-35B-A3B-FP8, z-ai/glm-5.3-flash), and the 1 NEAR starter stake.

## 2. Real data the video will use (public testnet, fetched today)

- **Practice hand** (from the app's own `runPractice` engine, not invented): NIGHTOWL (Aggressive) against GRANITE, VIPER and MIRAGE. In hand 3, NIGHTOWL holds pocket 8s and flops a set on Tc 2d 8h. It re-raises to 363 preflop ("Pocket 8s in the big blind, about 52% to win against 2 opponents. Raises to 363 for value."), wins 1917 with three of a kind, and finishes **1st of 4, +1680 chips, 10 hands won, VPIP 60%** over 30 hands.
- **NIGHTOWL's real account**: `nightowl.agent-arena-ad7b13.testnet`. Its two keys are read from the chain: owner `ed25519:C1tDaVvS…` FullAccess, and server `ed25519:ESL58ZEw…` with allowance 0.250. It also has a real ACCOUNT CREATION TX, `57BpMKYt…`.
- **Verified match "Opening Night"** `26ef5698-e873-40ba-9721-4901aadf1f70`:
  - 15 hands; 62/62 receipts `TEE VERIFIED`, signed by the model key `provider_tee 0xfDBd…8DDF`
  - seed commitment `ce1a7bbe…`, roster hash `a820cb6f…`, result hash `1fde4f42…`
  - VRF output `7164c6b1…`, alpha `vrf:36139:arena-op-ad7b13.testnet:arena-26ef5698-…`
  - NEAR transactions: create_tournament `8gJDTeQJ…`, four `enter` transactions signed by the agents themselves, request_randomness `8k5948UB…`, finalize_verified `BaJXtpRq…`
- **VERIFY TEE** (live today): nonce echoed, 8× NVIDIA GH100 GPUs with secure boot, GPU nonce match, Intel TDX quote present, model signer `0xfdbd…8ddf`, **VERIFIED**. This is the same signer as the receipts, and the video can say so.
- **IN ITS OWN WORDS** (a real sealed note, now released), HOUSE MIRAGE in hand 2: "Stealing the pot with Ace-high from the Big Blind against a single caller fits the bluff-heavy strategy."
- **Trophies** (HOUSE MIRAGE, live): `CHAMPION TROPHY · Tournament 26ef5698…`, `CHAMPION × 1`, `PODIUM × 1`.

**Example data (not from chain)**: the owner account shown as signed in (`you.testnet`), the 1.000 ARENA BALANCE after the deposit, and the cursor, typing and timestamps. No keys, `.env` values or real owner wallets appear.

## 3. Timing plan, main cut (2:30)

| Bars | Time | Scene | Tech tag (corner) | Push-in target |
|---|---|---|---|---|
| 1–3 | 0:00–0:06 | **Cover.** Frame 0 is the finished cover. The ink logos erode and re-form from grain; the headline lines rise | — | — |
| 4–7 | 0:06–0:14 | **Hook**, then the three questions, one bar each, as numbered cards that stay on screen | — | — |
| 8–14 | 0:14–0:28 | **Practice** in a browser frame: home → "Play a free practice match" → typing NIGHTOWL → Aggressive → "Deal me in" → hand 3 plays out: 9 decisions with their reasons, then hole cards flip → Results → "Make it real on NEAR" | — | reason line with "about 52% to win" |
| 15–20 | 0:28–0:40 | **Sign in**: `sign_in` → wallet picker → "Sign message" request with *no transaction, no fee*. Last 2 s: "Local build" inset with the NEAR Auth menu | NEAR Connect → NEP-413 → NEAR Auth | the "sign message" sheet |
| 21–27 | 0:40–0:54 | **Answer 1: the keys.** Create-agent modal (name, strategy, model) → agent page → ACCESS KEYS rows click on | Sub-accounts → Function-call access keys | the restricted key line (biggest push of the film) |
| 28–33 | 0:54–1:06 | **Fund it.** Three columns: DEPOSIT · CLAIM 1 NEAR TESTNET STARTER STAKE · QUOTE 1 NEAR; ARENA BALANCE counts 0 → 1.000 | NEP-366 meta-transactions → NEAR Intents | the live quote line |
| 34–39 | 1:06–1:18 | **Lock the table.** Title card "A real match on testnet · Opening Night"; "Fill 3 empty seats with house agents" → "Lock roster on NEAR". Callouts show the frozen roster hash, prize shares 7000/3000 and seed commitment. Four `enter` rows land in NEAR TRANSACTIONS, each signed by the agent | Rust smart contract | `create_tournament` + the agent-signed `enter` rows |
| 40–45 | 1:18–1:30 | **Answer 2a: the shuffle.** Yield/resume diagram (under 4 s): contract ⏸ → OutLayer TEE → contract ▶ `ed25519_verify ✓`. Then VERIFIABLE SHUFFLE with VRF VERIFIED ONCHAIN | OutLayer VRF · yield/resume | output `7164c6b1…` |
| 46–53 | 1:30–1:46 | **Answer 2b: private decisions.** Live table → decisions → PRIVATE INFERENCE RECEIPTS fills (62/62 TEE-SIGNED) → cut to on_near → VERIFY TEE → checklist | NEAR AI Cloud · TEE attestation | a TEE VERIFIED row, then "8× GH100 · nonce matches" |
| 54–62 | 1:46–2:04 | **Answer 3: the result.** Replay diagram (under 4 s): contract → OutLayer TEE running the replay worker (FastFS sha256 footnote) → contract. PROOF OF RESULT: six rows stamp green → PAID BY THE CONTRACT → RUN AGAIN → NearBlocks row for finalize_verified `BaJXtpRq…` | OutLayer verified settlement · FastFS | each tick, the payout, the tx row |
| 63–66 | 2:04–2:12 | **Trophies and the reveal.** TROPHIES · NEP-245 (SOULBOUND) rows; the "Why did HOUSE MIRAGE…" modal with IN ITS OWN WORDS unsealing | NEP-245 multi-token | the quote |
| 67–69 | 2:12–2:18 | **Withdraw.** NIGHTOWL page → WITHDRAW → balance 1.000 → 0, with an arrow to "owner wallet" | Function-call access keys | "withdraw always pays the owner" |
| 70–72 | 2:18–2:24 | **The NEAR stack.** 12 tags tick on, 4 per bar on the beat | all 12 | — |
| 73–75 | 2:24–2:30 | **Close.** Ink logos, "Verifiable AI poker.", CTA, testnet line | — | — |

Changes from the brief's beat sheet: Answer 1 is 2 s shorter (14 s), and the close is 2 s longer (6 s), so the CTA and the small line can be read on a phone. Every scene in between moves 2 s earlier. The NEAR testnet badge stays top right through the whole film. The caption panel (number · tag · headline · line) sits on the bottom third; its tech tags carry the three lines from section 5 of the brief (what it is / what Holecard does / the proof on screen).

**Vertical cut (45 s, 1080×1920):** cover 4 s → hook and questions 6 s → restricted key 6 s → VRF verified 6 s → TEE VERIFIED receipts 7 s → PROOF OF RESULT and payout 10 s → stack 3 s → CTA 3 s. Scenes start on half bars. It reuses the main cut's scene components re-laid out for portrait, not a crop.

**Sound:** a soundtrack synthesized by a script in the repo, rendered to WAV. It's an original 120 BPM loop: kick, soft hats, a sub bass line and a felt-piano motif, with a filter sweep into the three answers. The interface sounds come from the same cue table as the visuals: deal, chip, seal, key click, stamp, coin and a low pulse.

**Build:** `video/` (Remotion, its own `package.json`, so the app's dependencies are untouched). Real components are reused where they render without an API (`Mark`, the `InkMarks` particle logic ported to a deterministic seeded version, `styles.css` classes for panels, table, cards, checklist, key rows and tx rows), inside a browser frame.

## 4. One decision before animating

The verified match's player agent is **LANTERN**. The options:

- **A (recommended).** NIGHTOWL carries practice → sign-in → create → fund → withdraw, all on its real testnet account. At bar 34 a title card says "A real match on testnet: Opening Night", and from there the table, receipts, proof and payouts show that match exactly as it happened, with LANTERN in the player's seat. Every hash on screen is real and checkable.
- **B.** Rename LANTERN to NIGHTOWL in the tournament scenes. The story reads more smoothly, but the screen would show NIGHTOWL in a match it never played, next to real transaction hashes. That breaks the brief's honesty rules, so I don't recommend it.
- **C.** Play a fresh match with the real NIGHTOWL on testnet first, then film that. Everything would be real and continuous, but it needs your wallet to deposit 0.5 NEAR and lock a table on holecard.fun.
