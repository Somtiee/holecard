# Holecard: from repository to fully working deployment

This guide takes you from a fresh checkout to a hosted Holecard where every feature works: wallet and email sign-in, agents with their own NEAR accounts, private TEE decisions, verifiable shuffles, escrowed prizes, house agents, trophies, gasless play, Intents quotes and the Agent Market worker. Follow the steps in order. Each step ends with a check so you know it worked before moving on.

Time: about 60–90 minutes the first time. Cost: free on testnet (faucet NEAR), plus NEAR AI Cloud credits.

---

## 0. What you need

| Tool | Install | Check |
| --- | --- | --- |
| Node.js 22+ (24 LTS recommended) | https://nodejs.org | `node -v` |
| Docker Desktop | https://www.docker.com | `docker -v` |
| Rust + wasm target | `curl https://sh.rustup.rs -sSf \| sh` then `rustup target add wasm32-unknown-unknown` | `cargo -V` |
| cargo-near | `cargo install --locked cargo-near` | `cargo near --version` |
| near-cli-rs | `cargo install --locked near-cli-rs` | `near --version` |
| Railway CLI (hosting) | `npm i -g @railway/cli` | `railway --version` |

Then, from the repository root:

```sh
npm ci
npm test                 # 53 tests should pass
npm run test:contracts   # 29 tests should pass
```

---

## 1. Try it locally first (5 minutes, no keys)

```sh
docker compose up -d     # local Postgres
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:5173/#/practice and play a practice game. If that works, the engine, server, database and UI are all healthy. Stop with Ctrl-C.

> **Careful:** once `.env` contains real NEAR keys, every server you start with it (including `npm run dev`) acts on testnet: it creates house agents, enters tournaments and finalizes them. Use `HOUSE_AGENTS=off` in a scratch `.env` when you only want to look at the UI.

---

## 2. NEAR accounts

You need three testnet accounts. The faucet funds each with 10 NEAR.

```sh
near account create-account sponsor-by-faucet-service my-holecard.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
near account create-account sponsor-by-faucet-service my-holecard-op.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
near account create-account sponsor-by-faucet-service my-holecard-relay.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

| Account | Role | Keep funded with |
| --- | --- | --- |
| `my-holecard.testnet` | the contract | ~5 NEAR (storage) |
| `my-holecard-op.testnet` | operator: creates agents and tournaments, funds house seats, pays VRF fees | 10+ NEAR |
| `my-holecard-relay.testnet` | relayer: pays gas for gasless play and NEAR Auth, sends starter stakes | 10+ NEAR |

The operator spends roughly: 0.1 NEAR per new agent account, 0.05 NEAR per tournament for OutLayer VRF (unused part refunded), the house's entry fees (won back when house agents win), and gas. The relayer spends `SPONSOR_NEAR` per new player (capped by `SPONSOR_DAILY_CAP`) plus gas. Top up by transferring from another testnet account (new faucet-funded accounts come with 10 NEAR) when they run low.

**Already have the live contract (`agent-arena-ad7b13.testnet`)?** Skip to step 3b.

---

## 3. Contract

### 3a. Fresh deployment

```sh
scripts/deploy-testnet.sh my-holecard.testnet my-holecard-op.testnet
```

Check:

```sh
near contract call-function as-read-only my-holecard.testnet get_config json-args '{}' network-config testnet now
```

You should see your operator, `"agent_seed": "100000000000000000000000"` and `"operator_funds_agents": true`.

### 3b. Upgrading the existing contract (recommended for `agent-arena-ad7b13.testnet`)

The live contract predates two fixes: the operator now pays new agent accounts (escrow can never be drained), and trophies use the Holecard name. Upgrading keeps all state.

```sh
scripts/upgrade-testnet.sh agent-arena-ad7b13.testnet
```

You need the contract account's key in `~/.near-credentials/testnet/`. The script runs the tests, builds, deploys and checks for `operator_funds_agents: true`.

### 3c. Verifiable shuffles (OutLayer VRF)

The live contract already has its VRF source set. For a fresh contract:

1. `git clone https://github.com/out-layer/vrf-example && cd vrf-example && cargo build --locked --target wasm32-wasip2 --release`
2. From the Holecard repo: `node --import tsx scripts/fastfs-upload.ts <path to the .wasm>`. It prints a `WasmUrl`.
3. At https://app.outlayer.ai (testnet), create a project (for example `my-holecard.testnet/holecard-vrf`) whose source is that `WasmUrl`.
4. Point the contract at it. On a fresh deployment, pass `OUTLAYER_PROJECT_ID=my-holecard.testnet/holecard-vrf` to `scripts/deploy-testnet.sh`. For a contract that is already deployed, call it directly (signed by the contract account, the only account allowed to change the VRF key):

   ```sh
   VRF_KEY=$(curl -s https://testnet-api.outlayer.ai/vrf/pubkey | python3 -c 'import sys,json;print(json.load(sys.stdin)["vrf_public_key_hex"])')
   near contract call-function as-transaction my-holecard.testnet set_randomness_source \
     json-args "{\"source\":{\"outlayer\":\"outlayer.testnet\",\"project_id\":\"my-holecard.testnet/holecard-vrf\",\"vrf_pubkey_hex\":\"$VRF_KEY\"}}" \
     prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as my-holecard.testnet network-config testnet sign-with-legacy-keychain send
   ```

Check: `get_config` shows a `randomness_source`. Without one, tournaments still work, but decks come only from the operator's committed seed, with no VRF mix.

---

## 4. NEAR AI Cloud (private model decisions)

1. Get an API key at https://cloud.near.ai (or the NEAR Builders credit at https://nearbuilders.org/dashboard).
2. Pick models from the NEAR AI Cloud catalogue that run in TEEs. The default allowlist is in `.env.example` (`NEARAI_MODELS`): `Qwen/Qwen3.6-35B-A3B-FP8` and `z-ai/glm-5.3-flash`, measured at ~0.5–3 s per decision. The arena turns model reasoning off (`chat_template_kwargs.enable_thinking=false` for Qwen, `reasoning_effort=low` for GLM) because poker turns are timed; with reasoning on, Qwen 3.6 spent its whole token budget thinking and returned no answer, and GLM took ~25 s. `Qwen/Qwen3.8-27B` was dropped: it took 15–38 s per decision on the shared endpoint.
3. Check the setup before running a tournament: `node --import tsx scripts/check-nearai.ts`. For each model it fetches a nonce-bound attestation report, verifies the NVIDIA GPU evidence, asks for one poker decision, and verifies the enclave's signature over that exchange. Every row should show `"attested":true` and `"receipt":"TEE VERIFIED (provider_tee)"`.

Check (after step 6): open **on_near → Verify TEE**. It should show a fresh attestation with the nonce echoed and signing addresses listed.

Without a key you can still demo tournaments with `ARENA_DECISION_POLICY=fixture`. They play with a deterministic policy, are labelled as such, and produce no TEE receipts.

---

## 5. Optional integrations

| Feature | What to do | Variables |
| --- | --- | --- |
| **Email / Google / passkey sign-in (NEAR Auth)** | On `http://localhost:3000` it works with NEAR Auth's shared testnet client (port 3000 exactly). For a hosted domain, ask NEAR Auth to allowlist `https://<your-domain>/` as a callback (GitHub issues at Peersyst/fast-auth or the NEAR Auth Discord), or configure a dedicated client. The server detects the allowlisting by itself. | `FASTAUTH_CLIENT_ID`, `FASTAUTH_DOMAIN`, `FASTAUTH_SIGNING_AUDIENCE` (all optional) |
| **Gasless play + starter stakes** | Use the relayer account from step 2. | `RELAYER_ID`, `RELAYER_PRIVATE_KEY`, `SPONSOR_NEAR`, `SPONSOR_DAILY_CAP` |
| **NEAR Intents quotes** | Any mainnet account as the quote recipient (nothing executes on testnet). Optional JWT from https://partners.near-intents.org. | `INTENTS_QUOTE_RECIPIENT`, `ONECLICK_JWT` |
| **Agent Market worker (Arena Coach)** | Create a listing at https://market.near.ai and copy its `aat_…` token and URL. | `AGENT_MARKET_TOKEN`, `AGENT_MARKET_LISTING_URL` |
| **House agents** | On by default. Cap the house's entry fee. | `HOUSE_AGENTS`, `HOUSE_MAX_ENTRY_NEAR` |

---

## 6. Host it (Railway)

The repository includes a `Dockerfile` and Railway infrastructure-as-code in `.railway/railway.ts` (one service plus Postgres).

1. `railway login`, then `railway link` to your project (or `railway init` for a new one).
2. Add a Postgres database in the Railway dashboard if the project does not have one. `DATABASE_URL` is wired automatically.
3. Set variables (dashboard → service → Variables). Secrets come from `~/.near-credentials/testnet/<account>.json` (`private_key`):

   | Variable | Value |
   | --- | --- |
   | `PUBLIC_ORIGIN` | `https://<your-service>.up.railway.app` (exactly what the browser shows) |
   | `PUBLIC_HOSTNAME` | `<your-service>.up.railway.app` |
   | `NEAR_NETWORK` | `testnet` |
   | `ARENA_CONTRACT_ID` / `ARENA_OPERATOR_ID` | from step 2/3 |
   | `ARENA_OPERATOR_PRIVATE_KEY` | operator `private_key` |
   | `AGENT_KEY_SECRET` | `openssl rand -hex 32`. **Never change it later**: it encrypts every agent's server key and derives the house agents' owner keys. |
   | `NEARAI_API_KEY`, `NEARAI_MODELS` | from step 4 |
   | `RELAYER_ID`, `RELAYER_PRIVATE_KEY`, `SPONSOR_NEAR` | from step 5 |
   | anything else from step 5 | as needed |

4. Deploy: `railway up` from the repository root (or connect the GitHub repository for automatic deploys).
5. Generate a public domain in Railway (Settings → Networking) if you have not already, and make sure `PUBLIC_ORIGIN` matches it exactly.

Checks:

```sh
curl https://<your-domain>/api/ready      # {"ok":true}
curl https://<your-domain>/api/health     # nearConfigured, nearAiConfigured and the contract config
```

Within a minute of the first start, the server creates the three house agents on NEAR (`house-granite-xxxx.<contract>`, …). You will see them under **agents** with a HOUSE label.

---

## 7. End-to-end smoke test (10 minutes)

Do this once in the browser on the hosted URL. Every step should succeed.

1. **Practice:** `/#/practice` → play a game → Results.
2. **Sign in:** sign_in → NEAR wallet (or Email/Google/Passkey once NEAR Auth accepts your domain; on localhost:3000 it already does).
3. **Create an agent:** Create agent → name, strategy, model. The agent page shows two access keys: owner (full) and arena server (restricted).
4. **Fund it:** claim the starter stake, or DEPOSIT 1 NEAR from your wallet. ARENA BALANCE shows the amount.
5. **Open a table:** arenas → Create tournament (entry 1 NEAR, 4 seats, 5 min). Reserve your agent.
6. **Fill with house agents:** click **Fill 3 empty seats with house agents**, then **Lock roster on NEAR**.
7. **Watch:** within a minute every agent enters by itself (the house tops up its own seats), the contract starts the match and requests VRF, and hands play live with TEE receipts.
8. **Settle:** after 5 minutes the operator finalizes. Open any decision → **In its own words** shows the model's explanation. **Run verification** passes. Trophies appear on the winner's page.
9. **Withdraw:** WITHDRAW on your agent page sends the winnings to your wallet.

The scripted equivalent (two players, no house agents) is `npm run e2e:testnet` against a running server.

---

## 8. Hackathon submission checklist

- [ ] Repository is public (judges cannot open private ones).
- [ ] README "Hosted demo" row points at your Railway URL.
- [ ] Demo post on X: say you built it at NEAR HACKATHON, tag @NEARProtocol and #NEARHackathon, attach a 60–90 second video. The link preview uses `public/og.png` automatically once `PUBLIC_ORIGIN` is set. Suggested video: practice game → create agent → fill with house agents → live hand → settle → "In its own words" → verification.
- [ ] Submit the form at https://nearhackathon.com with the repository link and the demo post link before 14 Nov 2026, 23:59 UTC. Track: Games With Real Economies (add Agent Economy, Privacy & Private AI and AI Security as relevant).

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Banner "Testnet setup in progress" | One of `ARENA_CONTRACT_ID`, `ARENA_OPERATOR_ID`, `ARENA_OPERATOR_PRIVATE_KEY`, `AGENT_KEY_SECRET` or the NEAR AI settings is missing. `/api/health` says which. |
| "Request origin does not match this arena" | `PUBLIC_ORIGIN` differs from the URL in the browser (scheme, host and port must match exactly). |
| Sign-in fails with a recipient error | `PUBLIC_HOSTNAME` must be the browser's host name. |
| Agent creation fails with `ATTACH_EXACT_AGENT_SEED` | The server is older than the contract. Redeploy the app. |
| House agents never appear | `HOUSE_AGENTS=off`, the operator is out of NEAR, or `AGENT_KEY_SECRET` is missing. Check the server logs for "House agent". |
| Tournament stuck in funding | An agent's arena balance is below the entry fee. Deposit or claim the starter stake; house seats are topped up automatically up to `HOUSE_MAX_ENTRY_NEAR`. |
| No shuffle proof | No `randomness_source` on the contract (step 3c), or OutLayer is busy; the server retries every two minutes. |
| No TEE receipts | `ARENA_DECISION_POLICY=fixture` is set, or `NEARAI_API_KEY` is missing. |
| Social preview has no image | `PUBLIC_ORIGIN` is unset, so the image URL is relative. |
