#!/usr/bin/env bash
# Deploy the Holecard contract to NEAR testnet with near-cli-rs.
# Usage: scripts/deploy-testnet.sh <contract-account.testnet> <operator-account.testnet>
# Both accounts must already exist and be in your near-cli keychain. Create free ones with:
#   near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
# The operator attaches 0.1 NEAR to each create_agent call to seed the new agent account (escrow never pays).
# To upgrade an existing deployment without touching its state, use scripts/upgrade-testnet.sh.
set -euo pipefail
CONTRACT=${1:?contract account id}
OPERATOR=${2:?operator account id}
SEED_YOCTO=${AGENT_SEED_YOCTO:-100000000000000000000000}        # 0.1 NEAR per agent account
ALLOWANCE_YOCTO=${AGENT_ALLOWANCE_YOCTO:-250000000000000000000000} # 0.25 NEAR gas cap for the server key
cd "$(dirname "$0")/../contracts/near"
cargo near build non-reproducible-wasm
near contract deploy "$CONTRACT" use-file target/near/holecard.wasm \
  with-init-call new json-args "{\"operator\":\"$OPERATOR\",\"agent_seed\":\"$SEED_YOCTO\",\"agent_gas_allowance\":\"$ALLOWANCE_YOCTO\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only "$CONTRACT" get_config json-args '{}' network-config testnet now
# Optional: verifiable deck randomness from OutLayer VRF. Deploy github.com/out-layer/vrf-example as an
# OutLayer project first (https://app.outlayer.ai, testnet), then: OUTLAYER_PROJECT_ID=<you>.testnet/arena-vrf
if [ -n "${OUTLAYER_PROJECT_ID:-}" ]; then
  VRF_KEY=$(curl -s https://testnet-api.outlayer.ai/vrf/pubkey | python3 -c 'import sys,json;print(json.load(sys.stdin)["vrf_public_key_hex"])')
  near contract call-function as-transaction "$CONTRACT" set_randomness_source \
    json-args "{\"source\":{\"outlayer\":\"outlayer.testnet\",\"project_id\":\"$OUTLAYER_PROJECT_ID\",\"vrf_pubkey_hex\":\"$VRF_KEY\"}}" \
    prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$CONTRACT" network-config testnet sign-with-legacy-keychain send
fi
echo "Set ARENA_CONTRACT_ID=$CONTRACT and ARENA_OPERATOR_ID=$OPERATOR in .env."
echo "ARENA_OPERATOR_PRIVATE_KEY is the private_key in ~/.near-credentials/testnet/$OPERATOR.json"
