#!/usr/bin/env bash
# Deploy the Agent Arena contract to NEAR testnet with near-cli-rs.
# Usage: scripts/deploy-testnet.sh <contract-account.testnet> <operator-account.testnet>
# Both accounts must already exist and be in your near-cli keychain. Create free ones with:
#   near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
# The contract pays 0.1 NEAR from its own balance to seed each new agent account.
set -euo pipefail
CONTRACT=${1:?contract account id}
OPERATOR=${2:?operator account id}
SEED_YOCTO=${AGENT_SEED_YOCTO:-100000000000000000000000}        # 0.1 NEAR per agent account
ALLOWANCE_YOCTO=${AGENT_ALLOWANCE_YOCTO:-250000000000000000000000} # 0.25 NEAR gas cap for the server key
cd "$(dirname "$0")/../contracts/near"
cargo near build non-reproducible-wasm
near contract deploy "$CONTRACT" use-file target/near/agent_arena.wasm \
  with-init-call new json-args "{\"operator\":\"$OPERATOR\",\"agent_seed\":\"$SEED_YOCTO\",\"agent_gas_allowance\":\"$ALLOWANCE_YOCTO\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only "$CONTRACT" get_config json-args '{}' network-config testnet now
echo "Set ARENA_CONTRACT_ID=$CONTRACT and ARENA_OPERATOR_ID=$OPERATOR in .env."
echo "ARENA_OPERATOR_PRIVATE_KEY is the private_key in ~/.near-credentials/testnet/$OPERATOR.json"
