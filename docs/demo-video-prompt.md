# Holecard demo video prompt

You are my motion designer. Make a product demo video for **Holecard**: an arena on NEAR where AI agents play Texas Hold'em tournaments for NEAR. Each agent is its own NEAR account, decides every move privately inside a NEAR AI Cloud TEE, plays with a deck shuffled by a VRF proof the contract checks, and is only paid after an independent TEE replays the whole match. The audience is NEAR hackathon judges (primary track: Games With Real Economies). They must finish the video knowing **which NEAR technologies Holecard uses, what each one does in the product, and how it is wired**, with proof on screen for every claim.

---

## 1. Read the repo first

Before designing anything, read this repository so the video shows the real product:

- **Screens and order:** `src/ui/pages/` and `src/ui/components/`. Show screens in the order a real user meets them.
- **Copy:** use the exact words on those screens. Do not invent UI copy. Captions and voiceover may use wording from `README.md` (especially "The problem", "How Holecard answers it" and "What NEAR does in this product").
- **NEAR facts:** take every technical claim from `README.md`, `contracts/near/src/lib.rs`, `workers/replay/` and `src/server/near/`. If something below disagrees with the code, the code wins; tell me.
- **Brand, used everywhere:**
  - background `#ebebeb`, ink `#111111`, accent green `#1cc744`
  - Space Grotesk for headlines, Inter for body, Geist Mono for small labels (lowercase with underscores: `practice`, `on_near`, `sign_in`)
  - the grain/noise texture and the two spray-painted rings from the home hero
- **Pixel truth:** where possible, render the real components with `src/ui/styles.css` inside the device frame instead of redrawing them.

---

## 2. The story: three questions, three proofs

Open with the hook: **"Would you let an AI play poker with your money?"**

Then the three questions from the README, one at a time:

1. **Who holds its keys?**
2. **Who sees its cards?**
3. **Who decides who won?**

The rest of the video answers each question with NEAR technology and a proof the viewer could check themselves. Close by showing the whole NEAR stack at once.

---

## 3. A tag for every NEAR technology

Whenever a NEAR technology appears, show a small **tech tag** in the corner of the frame: Geist Mono, green dot, for example `● NEAR · NEP-413`. Each tag gets three lines in the caption panel:

- **What it is** (one plain sentence a non-NEAR judge understands)
- **What Holecard does with it** (one sentence)
- **The proof on screen** (the panel, row or transaction the camera is pushing in on)

Use the reference table in section 5 for the wording. Every one of the twelve technologies must appear at least once in the main cut, and all twelve together in the closing stack montage.

---

## 4. Beat sheet (main cut, about 2:30, never over 3:00)

Tempo about 120 BPM, so one bar is 2 s. Every scene starts on a bar. Show me your own timing plan before animating; adjust these numbers if the story reads better.

| Time | Scene | What happens on screen | NEAR tech tag |
|---|---|---|---|
| 0:00–0:06 | **Cover and open** | Port the particle logic from `src/ui/components/InkMarks.tsx`: the Holecard mark (two hole cards) and the poker chip form out of loose grain inside their rings. Headline rises: **"Nobody sees their cards."** Lockup: **"Holecard × NEAR AI · OutLayer"**. Small `NEAR testnet` badge. | none |
| 0:06–0:14 | **The hook** | "Would you let an AI play poker with your money?" Then the three questions appear one by one. | none |
| 0:14–0:28 | **Free practice, no wallet** | Click **"Play a free practice match"**, name the agent NIGHTOWL, pick a strategy, click **"Deal me in"**. One hand against **GRANITE**, **VIPER** and **MIRAGE**: each action arrives with its reason and win chance; hole cards flip at the end. Cut to **Results**, then **"Make it real on NEAR"**. Caption: *Try it free. Then make it real on NEAR.* | none (this is the on-ramp) |
| 0:28–0:40 | **Sign in** | Click **sign_in**: the NEAR Connect wallet picker opens (Meteor, Intear, Nightly, Ledger, NEAR CLI). The wallet signs a message, not a transaction. Then a 2-second inset labelled **"Local build"**: the **Email · Google · Passkey** option, *NEAR Auth · no wallet, no gas*. | `NEAR Connect` · `NEP-413` · `NEAR Auth` |
| 0:40–0:56 | **Answer 1: the keys** | **Create agent**. The agent page shows its own account `nightowl.agent-arena-ad7b13.testnet` and **ACCESS KEYS (READ FROM CHAIN)**: **OWNER WALLET (FULL ACCESS)** and **ARENA SERVER (RESTRICTED)**, with "Only enter, withdraw on agent-arena-ad7b13.testnet · gas cap 0.25 NEAR · cannot attach deposits". Push in on that line. Caption: *The server can play for your agent. It can never take its money.* | `Sub-accounts` · `Function-call access keys` |
| 0:56–1:08 | **Fund it** | Three quick options side by side: **DEPOSIT** (wallet transaction); **CLAIM 1 NEAR TESTNET STARTER STAKE** (no NEAR needed, the relayer pays gas); **QUOTE 1 NEAR** from USDC on Base through NEAR Intents (dry run, nothing executes). **ARENA BALANCE** ticks up. | `NEP-366 meta-transactions` · `NEAR Intents` |
| 1:08–1:20 | **Lock the table** | Open a tournament, reserve the agent, click **"Fill empty seats with house agents"** (HOUSE GRANITE, HOUSE VIPER, HOUSE MIRAGE), then **"Lock roster on NEAR"**. Show what the contract freezes: roster hash, prize shares, and a commitment to the deck seed, all before a card is dealt. Each agent then enters by itself with its restricted key: no wallet popup. | `Rust smart contract` |
| 1:20–1:32 | **Answer 2a: the shuffle** | The contract asks OutLayer for randomness. Animate yield/resume: the transaction pauses, an OutLayer TEE produces a VRF value, the transaction resumes and the contract checks the Ed25519 proof itself (`env::ed25519_verify`). Push in on **VERIFIABLE SHUFFLE**. Caption: *The operator can't pick the cards: every deck mixes a seed committed before entry with randomness the contract verified.* | `OutLayer VRF` · `yield/resume` |
| 1:32–1:48 | **Answer 2b: private decisions** | Live table: a decision arrives, chips move. **PRIVATE INFERENCE RECEIPTS** fills with **TEE VERIFIED** rows. Cut to the NEAR page and click **VERIFY TEE**: a fresh, nonce-bound attestation of the model's enclave (NVIDIA GPU evidence plus the signing key). Caption: *Each move is decided on an open model inside a TEE. Holecard keeps only hashes of each request and response, and checks the enclave's signature over them.* | `NEAR AI Cloud` · `TEE attestation` |
| 1:48–2:06 | **Answer 3: the result** | Time runs out. The contract hands the match to OutLayer: a second TEE runs Holecard's replay worker, re-deals every hand from the committed seed and the verified VRF output, rejects any illegal action and derives the ranking. Then **PROOF OF RESULT** → **RUN ALL CHECKS**, each row ticking green (exact labels in section 6). Then **PAID BY THE CONTRACT**: **1.4** and **0.6 NEAR**. Push in on a **NEAR TRANSACTIONS** row linking to NearBlocks. Caption: *Wrong ranking? Nothing moves. The contract only pays what the replay proves.* | `OutLayer verified settlement` · `FastFS` |
| 2:06–2:14 | **Trophies and the reveal** | The winner gets a unique trophy and the podium gets badges: **TROPHIES · NEP-245 (SOULBOUND)**. Then **IN ITS OWN WORDS** unseals: the model's own one-line reason for each move, sealed until settlement. | `NEP-245 multi-token` |
| 2:14–2:20 | **Withdraw** | **WITHDRAW** on the agent page; the NEAR goes to the owner's wallet. Caption: *Even the agent's own key can only send winnings home.* | `Function-call access keys` |
| 2:20–2:26 | **The NEAR stack** | A grid of the twelve tech tags from section 5, each ticking on with a short label, on the beat. | all |
| 2:26–2:30 | **Close** | The ink logos again. Three words: **"Verifiable AI poker."** CTA: **Play free at holecard.fun**. Small line: *Every claim checkable on NEAR testnet · agent-arena-ad7b13.testnet* | none |

**Vertical cut (45 s, 1080x1920, for X):** cover (4 s) → hook and three questions (5 s) → restricted key line (6 s) → VRF proof checked on-chain (7 s) → TEE VERIFIED receipts (7 s) → PROOF OF RESULT ticking and PAID BY THE CONTRACT (10 s) → NEAR stack grid (3 s) → CTA (3 s).

---

## 5. NEAR technology reference (use this wording)

| # | Tech tag | What it is | How Holecard uses it | Proof to show |
|---|---|---|---|---|
| 1 | **NEAR Connect** | NEAR's wallet connector | One picker for Meteor, Intear, Nightly, Ledger and NEAR CLI, for sign-in and the owner's own deposit and withdraw transactions | The **Select wallet** modal |
| 2 | **NEP-413 signed messages** | The NEAR standard for signing a message without sending a transaction | Sign-in: the server verifies the ed25519 signature and checks on-chain that the key is a full-access key of that account | Wallet asks to sign a message; no transaction, no fee |
| 3 | **NEAR Auth (FastAuth)** | Email, Google or passkey sign-in; the user's NEAR key is derived by NEAR's MPC network, so there is no seed phrase | Sign-in without a wallet: the player approves a sign-in request that can never execute on chain, the relayer pays for the MPC signature, and the server checks it against the derived key | Local-build inset only (see section 7) |
| 4 | **Sub-accounts** | NEAR accounts can create child accounts | Every agent is its own account, `<name>.agent-arena-ad7b13.testnet`, created by the contract; the operator pays the 0.1 NEAR account seed, never the escrow | Agent page address and **ACCOUNT CREATION TX** |
| 5 | **Function-call access keys** | NEAR keys that can only call named methods on one contract, with a gas allowance and no deposits | The owner's wallet key is the only full-access key. The server's key can only call `enter` and `withdraw` on the arena contract, with a 0.25 NEAR gas cap, and `withdraw` always pays the owner | **ACCESS KEYS (READ FROM CHAIN)** rows |
| 6 | **Rust smart contract (near-sdk 5)** | Holecard's own contract, `agent-arena-ad7b13.testnet`, with 37 unit tests | Escrows entry fees; freezes the roster hash, prize shares and a deck-seed commitment before play; checks the seed reveal; pays to the exact yoctoNEAR; refunds unfilled or expired matches | **Lock roster on NEAR**, **NEAR TRANSACTIONS** |
| 7 | **NEP-366 meta-transactions** | Delegate actions: a user signs, someone else pays the gas | The Holecard relayer pays gas for players' `deposit` / `withdraw`, and only forwards those two calls to the arena contract. On testnet a one-time starter stake means a new player never has to buy NEAR | **CLAIM 1 NEAR TESTNET STARTER STAKE** |
| 8 | **NEAR Intents (1Click API)** | Cross-chain swaps settled through NEAR | Prices an agent's entry fee from USDC on Base, Arbitrum, Ethereum or Solana, or from ETH, SOL or BTC. Intents run on mainnet only, so this testnet build asks for `dry: true` quotes and executes nothing | A live quote on the agent page, e.g. "3.49 USDC on Base → 1 wNEAR" |
| 9 | **NEAR AI Cloud (private inference)** | Open models served from inside TEEs (trusted execution environments) | Every poker decision is a chat completion on a TEE-hosted model (Qwen 3.6 or GLM-5.3). Holecard stores only sha256 hashes of the exact request and response, fetches the enclave's signature over them and checks it against a fresh, nonce-bound attestation | **PRIVATE INFERENCE RECEIPTS · TEE VERIFIED**, **VERIFY TEE** |
| 10 | **OutLayer VRF + yield/resume** | Verifiable randomness from a TEE, delivered back into the same NEAR transaction | `request_randomness` yields while OutLayer produces a VRF value, then resumes into `on_randomness`, which verifies the Ed25519 proof on-chain and stores its hash. Each hand's deck mixes it with the seed the operator committed before entry, so values can't be re-rolled and no payout happens without verified randomness | **VERIFIABLE SHUFFLE** panel |
| 11 | **OutLayer verified settlement** | Running Holecard's own code in a TEE on the contract's behalf | `finalize_verified` sends OutLayer only what the contract already trusts (checked seed, verified VRF output, roster commitments, paid places) plus the action log. The replay worker (a Rust port of the poker engine) re-deals every hand, rejects illegal actions and derives the ranking; `on_settlement_checked` pays only if it matches. It reproduced 200 simulated tournaments (8,663 hands) exactly | **PROOF OF RESULT** checklist |
| 12 | **NEP-245 multi-token** | NEAR's multi-token standard | Settling a match mints a unique `trophy:<tournament>` to the winner and `champion` / `podium` badges. They are soulbound (`mt_transfer` rejects), so any app can read the reputation but nobody can buy it | **TROPHIES · NEP-245 (SOULBOUND)** |

Supporting detail for tags 10 and 11 (on screen as a small footnote, not a scene): the replay worker's WASM is published on **FastFS** and pinned by its sha256, so anyone can check exactly what code the TEE ran.

---

## 6. Exact on-screen copy (verified in the code)

- Home: **"Nobody sees their cards."**, eyebrow **"AI agent poker · NEAR testnet"**, lockup **"Holecard × NEAR AI · OutLayer"**
- Practice: **"Play a free practice match"**, **"Deal me in"**, **"Make it real on NEAR"**; bots **GRANITE**, **VIPER**, **MIRAGE**
- Agent page: **ACCESS KEYS (READ FROM CHAIN)**, **OWNER WALLET (FULL ACCESS)**, **ARENA SERVER (RESTRICTED)**, "Only enter, withdraw on agent-arena-ad7b13.testnet · gas cap 0.25 NEAR · cannot attach deposits", **ARENA BALANCE**, **DEPOSIT**, **WITHDRAW**, **CLAIM 1 NEAR TESTNET STARTER STAKE**, **TROPHIES · NEP-245 (SOULBOUND)**
- Tournament: **"Fill empty seats with house agents"** (the button reads "Fill 3 empty seats with house agents" when three are open), **"Lock roster on NEAR"**, **VERIFIABLE SHUFFLE**, **PRIVATE INFERENCE RECEIPTS**, **TEE VERIFIED**, **NEAR TRANSACTIONS**, **IN ITS OWN WORDS**
- **PROOF OF RESULT** rows, in order:
  - "Roster and strategies locked on NEAR before play"
  - "Operator seed matches its pre-match commitment"
  - "Shuffle entropy from OutLayer VRF, proof checked onchain"
  - "62/62 model decisions carry a NEAR AI TEE signature"
  - "Payout released only after an OutLayer TEE replayed the match"
- then **PAID BY THE CONTRACT**, and the button **RUN ALL CHECKS**
- NEAR page: **VERIFY TEE**
- Leaderboard tabs: **NEAR profit** and **Skill rating**

---

## 7. Honesty rules (do not break these)

- Keep a visible **NEAR testnet** badge throughout. Never imply mainnet or that testnet NEAR has value.
- **NEAR Auth** (email, Google, passkey) runs on a local build at `http://localhost:3000`; holecard.fun signs in with a wallet until NEAR Auth allowlists the domain (the option then appears by itself). Show NEAR Auth only in an inset labelled **"Local build"**, and only after you have completed a sign-in with it yourself. If NEAR Auth allowlists holecard.fun before you record, show it on the live site and drop the label.
- **NEAR Intents** quotes are dry runs: say "quote", never "swap" or "bridge".
- **Agent Market** (the Arena Coach worker) is not running on the hosted server. Leave it out of the main cut; if you show it at all, show only its preview and say so.
- The replay proves every action was legal and the ranking is right. It does not prove which model chose each action; that is the TEE receipts' job. Never merge the two claims into one.

---

## 8. Data

- **Allowed, and better than examples (public testnet facts):**
  - contract `agent-arena-ad7b13.testnet`, operator `arena-op-ad7b13.testnet`
  - verified match `26ef5698-e873-40ba-9721-4901aadf1f70` (15 hands, 62/62 TEE-signed decisions, payouts 1.4 and 0.6 NEAR to HOUSE MIRAGE and HOUSE GRANITE)
  - its settlement transaction `BaJXtpRq6dNaq4qsJFU3k2srNtJiNRB3PQdtyFfcjfLp`
  - OutLayer projects `agent-arena-ad7b13.testnet/arena-vrf` and `agent-arena-ad7b13.testnet/arena-replay`
- **Example data, list it for me:** NIGHTOWL, player account names, chip counts, timestamps.
- **Never** show keys, `.env` values, or any real person's wallet.

---

## 9. How to build it

- Use Remotion (React), so every frame is code and it renders to MP4 with no extra installs.
- Rebuild the interface inside a device frame. Show real interaction: typing the agent name, taps with a visible touch, cards dealing, decisions arriving, chips moving, checklist rows ticking, balances counting up.
- Move the camera: push in on each proof (the restricted key line, a TEE VERIFIED row, the VRF proof, each green tick, the payout, a NearBlocks transaction) and pull back between scenes.
- Every scene gets a caption panel: number, tech tag, headline, one supporting line. Large enough to read on a phone.
- For yield/resume and the replay, use simple diagrams in the brand style (rounded boxes, mono labels, a green pulse travelling contract → OutLayer TEE → contract). Keep each under 4 seconds.
- Make the very first frame a finished cover image (formed ink logos, headline, lockup), because apps use it as the thumbnail.
- Optional voiceover: one calm sentence per scene, written from section 5, never more than the caption says.

## 10. Sound

- Write an original soundtrack in code so there is nothing to license, about 120 BPM; every scene starts on a bar.
- Interface sounds timed from the same file as the visuals: card deal, chip click, a soft "seal" per TEE receipt, a click for each key row, a stamp per proof row, a coin settle for the payout, a low pulse for yield/resume.

## 11. Quality

- Render review frames of every scene and check them yourself before the final export. Fix anything cropped, overlapping or too small to read on a phone.
- Check every tech tag against section 5 and every UI string against section 6.
- Export 1920x1080 (main cut) and 1080x1920 (vertical cut), at high quality so it survives compression.

Use your best motion design judgement throughout. Match the polish of a top demo-day video; do not copy any reference.
