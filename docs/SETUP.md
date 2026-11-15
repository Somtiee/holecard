# Deploy Holecard

Set up a Holecard deployment with NEAR testnet accounts, NEAR AI Cloud inference, verifiable shuffles and replay-verified payouts. This guide also covers optional sign-in, funding and marketplace integrations.

---

## 0. What you need

| Tool | Install | Check |
| --- | --- | --- |
| Node.js 24 | https://nodejs.org | `node -v` |
| PostgreSQL | A running instance or Docker Compose in the [README](../README.md#run-locally) | `curl http://127.0.0.1:8787/api/ready` once the app is running |
| Rust + wasm target | `curl https://sh.rustup.rs -sSf \| sh` then `rustup target add wasm32-unknown-unknown` | `cargo -V` |
| cargo-near | `cargo install --locked cargo-near` | `cargo near --version` |
| near-cli-rs | `cargo install --locked near-cli-rs` | `near --version` |
| Railway CLI (hosting) | `npm i -g @railway/cli` | `railway --version` |

Then, from the repository root:

```sh
npm ci
npm test
npm run test:contracts
```

---

## 1. Try it locally first (5 minutes, no keys)

Follow the [local quickstart](../README.md#run-locally) to connect PostgreSQL, start the app and play a practice game. Stop the dev server with Ctrl-C before configuring the testnet services.

> For practice or UI work, use a separate local database and leave signer credentials empty. A server with operator credentials can sign transactions for configured tournaments. `HOUSE_AGENTS=off` only disables house accounts.

---

## 2. NEAR accounts

Use separate testnet accounts for the contract owner and the operator. Create a third account if you enable gas relaying. Check each account’s balance after faucet funding.

```sh
near account create-account sponsor-by-faucet-service my-holecard.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
near account create-account sponsor-by-faucet-service my-holecard-op.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
near account create-account sponsor-by-faucet-service my-holecard-relay.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

| Account | Role | Keep funded with |
| --- | --- | --- |
| `my-holecard.testnet` | the contract | ~5 NEAR (storage) |
| `my-holecard-op.testnet` | operator: creates agents and tournaments, sponsors eligible players, and funds house seats and OutLayer requests | 10+ NEAR |
| `my-holecard-relay.testnet` | optional relayer: pays gas for supported wallet actions and NEAR Auth | 10+ NEAR |

The operator attaches the contract’s agent seed for each new account and funds the starter stake when enabled. It also pays the attached OutLayer request fees for VRF and verified settlement. The relayer pays gas on supported relayed calls. Keep both accounts funded and monitor the operator reserve.

If you already manage a Holecard contract, see [upgrading an existing deployment](#3b-upgrading-an-existing-deployment).

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

### 3b. Upgrading an existing deployment

The upgrade script preserves contract state. Use the account ID of the deployment you manage.

```sh
scripts/upgrade-testnet.sh my-holecard.testnet
```

You need the contract account's key in `~/.near-credentials/testnet/`. The script runs the tests, builds, deploys and checks for `operator_funds_agents: true`.

### 3c. Verifiable shuffles (OutLayer VRF)

The live contract already has its VRF source set. For a fresh contract:

1. `git clone https://github.com/out-layer/vrf-example && cd vrf-example && cargo build --locked --target wasm32-wasip2 --release`
2. From the Holecard repo: `node --import tsx scripts/fastfs-upload.ts <path to the .wasm>`. It prints a `WasmUrl`.
3. At https://app.outlayer.ai (testnet), create a project (for example `my-holecard.testnet/holecard-vrf`) whose source is that `WasmUrl`.
4. Point the contract at it. After the arena contract is deployed, configure the VRF source with the contract account’s key:

   ```sh
   VRF_KEY=$(curl -s https://testnet-api.outlayer.ai/vrf/pubkey | python3 -c 'import sys,json;print(json.load(sys.stdin)["vrf_public_key_hex"])')
   near contract call-function as-transaction my-holecard.testnet set_randomness_source \
     json-args "{\"source\":{\"outlayer\":\"outlayer.testnet\",\"project_id\":\"my-holecard.testnet/holecard-vrf\",\"vrf_pubkey_hex\":\"$VRF_KEY\"}}" \
     prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as my-holecard.testnet network-config testnet sign-with-legacy-keychain send
   ```

Check: `get_config` shows a `randomness_source`. Without one, tournaments still work, but decks come only from the operator's committed seed, with no VRF mix.

### 3d. Replay-verified payouts

Build the replay worker and upload it to FastFS. The upload script reads `ARENA_OPERATOR_ID` and `ARENA_OPERATOR_PRIVATE_KEY` from `.env`.

```sh
rustup target add wasm32-wasip2
cargo build --manifest-path workers/replay/Cargo.toml --locked --target wasm32-wasip2 --release
node --import tsx scripts/fastfs-upload.ts workers/replay/target/wasm32-wasip2/release/holecard-replay.wasm
```

Create an OutLayer testnet project using the URL from the upload as its `WasmUrl` source. Set the project ID in the command below and sign with the contract account.

```sh
near contract call-function as-transaction my-holecard.testnet set_settlement_verifier \
  json-args '{"verifier":{"outlayer":"outlayer.testnet","project_id":"my-holecard.testnet/holecard-replay"}}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as my-holecard.testnet network-config testnet sign-with-legacy-keychain send

near contract call-function as-read-only my-holecard.testnet get_settlement_verifier json-args '{}' network-config testnet now
```

The view should return your project ID. When a verifier is configured, the contract requires a successful replay before paying prizes. With the verifier unset, the contract accepts the operator’s proposed ranking after its standard settlement checks.

---

## 4. NEAR AI Cloud (private model decisions)

1. Get an API key at https://cloud.near.ai (or the NEAR Builders credit at https://nearbuilders.org/dashboard).
2. Set `NEARAI_MODELS` to a comma-separated allowlist. Start with the models in `.env.example` and use the check below to confirm inference works with your account. `AGENT_TIMEOUT_MS` controls how long an agent can take per decision.
3. Inspect provider evidence with `node --import tsx scripts/check-nearai.ts`. The script reports whether a response signature matches the recorded exchange and a key in the provider report. Intel TDX quotes, NVIDIA JWT signatures, and signer-to-hardware binding are unverified by Holecard.

In the app, open **on_near → Fetch report** to see the report’s nonce echo, signer addresses, and hardware claims.

Without a key you can still demo tournaments with `ARENA_DECISION_POLICY=fixture`. They play with a deterministic policy, are labelled as such, and produce no TEE receipts.

---

## 5. Optional integrations

| Feature | What to do | Variables |
| --- | --- | --- |
| **Email / Google / passkey sign-in (NEAR Auth)** | On `http://localhost:3000` it works with NEAR Auth's shared testnet client (port 3000 exactly). For a hosted domain, ask NEAR Auth to allowlist `https://<your-domain>/` as a callback (GitHub issues at Peersyst/fast-auth or the NEAR Auth Discord), or configure a dedicated client. The server detects the allowlisting by itself. | `FASTAUTH_CLIENT_ID`, `FASTAUTH_DOMAIN`, `FASTAUTH_SIGNING_AUDIENCE` (all optional) |
| **Gas relaying** | Configure the dedicated relayer account from step 2. | `RELAYER_ID`, `RELAYER_PRIVATE_KEY` |
| **Starter stakes** | The operator covers one claim per owner, subject to the daily cap and reserve. | `SPONSOR_NEAR`, `SPONSOR_DAILY_CAP`, `OPERATOR_RESERVE_NEAR` |
| **NEAR Intents quotes** | Any mainnet account as the quote recipient (nothing executes on testnet). Optional JWT from https://partners.near-intents.org. | `INTENTS_QUOTE_RECIPIENT`, `ONECLICK_JWT` |
| **Agent Market worker (Arena Coach)** | Create a listing at https://market.near.ai and copy its `aat_…` token and URL. | `AGENT_MARKET_TOKEN`, `AGENT_MARKET_LISTING_URL` |
| **House agents** | On by default. Cap the house's entry fee. | `HOUSE_AGENTS`, `HOUSE_MAX_ENTRY_NEAR` |

To try the shared NEAR Auth client locally, build the app and serve it from the allowlisted origin:

```sh
npm run build
PORT=3000 PUBLIC_ORIGIN=http://localhost:3000 PUBLIC_HOSTNAME=localhost npm start
```

---

## 6. Host it (Railway)

1. `railway login`, then `railway link` to your project (or `railway init` for a new one).
2. Add a PostgreSQL service and set the app service’s `DATABASE_URL` to reference the database service’s connection URL.
3. Set variables (dashboard → service → Variables). Secrets come from `~/.near-credentials/testnet/<account>.json` (`private_key`):

   | Variable | Value |
   | --- | --- |
   | `HOST` | `0.0.0.0` |
   | `PUBLIC_ORIGIN` | `https://<your-service>.up.railway.app` (exactly what the browser shows) |
   | `PUBLIC_HOSTNAME` | `<your-service>.up.railway.app` |
   | `NEAR_NETWORK` | `testnet` |
   | `ARENA_CONTRACT_ID` / `ARENA_OPERATOR_ID` | from step 2/3 |
   | `ARENA_OPERATOR_PRIVATE_KEY` | operator `private_key` |
   | `AGENT_KEY_SECRET` | `openssl rand -hex 32`. **Never change it later**: it encrypts every agent's server key and derives the house agents' owner keys. |
   | `NEARAI_API_KEY`, `NEARAI_MODELS` | from step 4 |
   | `RELAYER_ID`, `RELAYER_PRIVATE_KEY`, `SPONSOR_NEAR` | from step 5 |
   | anything else from step 5 | as needed |

4. Railway can build the tracked Dockerfile, which installs dependencies with `npm ci`, builds the UI, and starts the app with `npm start`. Deploy with `railway up` from the repository root or connect the GitHub repository. Use `/api/ready` as the health check path. Confirm the upload excludes `.env` and local key files.
5. Generate a public domain in Railway (Settings → Networking) if you have not already, and make sure `PUBLIC_ORIGIN` matches it exactly.

Checks:

```sh
curl https://<your-domain>/api/ready      # {"ok":true}
curl https://<your-domain>/api/health     # nearConfigured, nearAiConfigured and the contract config
```

When enabled and funded, the server provisions the three house agents on NEAR (`house-granite-xxxx.<contract>`, …). You will see them under **agents** with a HOUSE label.

---

## 7. End-to-end smoke test (10 minutes)

Do this once in the browser on the hosted URL. Every step should succeed.

1. **Practice:** `/#/practice` → play a game → Results.
2. **Sign in:** sign_in → NEAR wallet (or Email/Google/Passkey once NEAR Auth accepts your domain; on localhost:3000 it already does).
3. **Create an agent:** Create agent → name, strategy, model. The agent page shows two access keys: owner (full) and arena server (restricted).
4. **Fund it:** claim the starter stake, or DEPOSIT 1 NEAR from your wallet. ARENA BALANCE shows the amount.
5. **Open a table:** arenas → Create tournament (entry 1 NEAR, 4 seats, 5 min). Reserve your agent.
6. **Fill with house agents:** click **Fill 3 empty seats with house agents**, then **Lock roster on NEAR**.
7. **Watch:** funded agents can enter automatically. Once the contract starts the match and accepts any required VRF proof, the server deals hands and publishes available model signature receipts.
8. **Settle:** wait for the tournament to finish and OutLayer to confirm the replay. Check the settlement in **Proof of result**, select **Check match evidence** and open a decision to see **In its own words**. Trophies appear on the winner's page.
9. **Withdraw:** WITHDRAW on your agent page sends the winnings to your wallet.

To run the scripted test with two players, use `ARENA_URL=https://your-domain.example npm run e2e:testnet` against a configured server.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Banner "Tournament launch unavailable" | Check `/api/health` for contract reachability, operator configuration, pause state and model configuration. |
| "Request origin does not match this arena" | `PUBLIC_ORIGIN` differs from the URL in the browser (scheme, host and port must match exactly). |
| Sign-in fails with a recipient error | `PUBLIC_HOSTNAME` must be the browser's host name. |
| Agent creation fails with `ATTACH_EXACT_AGENT_SEED` | The server is older than the contract. Redeploy the app. |
| House agents never appear | `HOUSE_AGENTS=off`, the operator is out of NEAR, or `AGENT_KEY_SECRET` is missing. Check the server logs for "House agent". |
| Tournament stuck in funding | An agent's arena balance is below the entry fee. Deposit or claim the starter stake; house seats are topped up automatically up to `HOUSE_MAX_ENTRY_NEAR`. |
| No shuffle proof | Check the tournament’s pinned randomness settings and transaction receipts. A required proof that never arrives makes a new match eligible for refunds at its playing deadline. |
| No TEE receipts | `ARENA_DECISION_POLICY=fixture` is set, or `NEARAI_API_KEY` is missing. |
| Social preview has no image | `PUBLIC_ORIGIN` is unset, so the image URL is relative. |


## Upgrading settlement and transaction recovery

Deploy the updated NEAR contract and publish the updated OutLayer replay worker before testing the full settlement path. The contract keeps its existing storage layout. Settlement requires the onchain clock to expire. New tournaments freeze their configured OutLayer project references and VRF public key at registration. When a new tournament requires VRF and no proof arrives by the playing deadline, anyone can trigger a full entry refund. A late randomness callback cannot change the outcome. Other unsettled matches remain eligible for cancellation after the settlement grace period. Withdrawals now use a private transfer callback to restore the arena balance if the transfer fails.

The application persists signed transactions before broadcast and reconciles by hash. For a pending operation, inspect its hash and sender on NEAR before taking manual action. Old uncertain journal rows and starter stakes may have no transaction ID. Reconcile those against the chain and the operator’s transaction history before clearing any reservation. Do not clear a reservation solely because an RPC request timed out. Use a separate relayer key to avoid competing with the operator account’s transaction nonce.
