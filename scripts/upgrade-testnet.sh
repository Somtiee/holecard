#!/usr/bin/env bash
# Upgrade the code of an already-deployed Holecard contract on NEAR testnet, keeping its state.
# Usage: scripts/upgrade-testnet.sh <contract-account.testnet>
# Signs with the contract account's own key from the near-cli legacy keychain. No init call is made,
# so agents, arena balances, tournaments and trophies are untouched (the storage layout is unchanged).
set -euo pipefail
CONTRACT=${1:?contract account id}
cd "$(dirname "$0")/../contracts/near"
cargo test --quiet
cargo near build non-reproducible-wasm
near contract deploy "$CONTRACT" use-file target/near/holecard.wasm without-init-call \
  network-config testnet sign-with-legacy-keychain send
CONFIG=$(near contract call-function as-read-only "$CONTRACT" get_config json-args '{}' network-config testnet now 2>&1)
echo "$CONFIG"
if echo "$CONFIG" | grep -q '"operator_funds_agents": true'; then
  echo "Upgraded. The operator now attaches the agent seed to create_agent; keep its account funded (0.1 NEAR per new agent)."
else
  echo "Upgrade not confirmed: get_config does not report operator_funds_agents." >&2; exit 1
fi
