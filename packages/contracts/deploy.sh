#!/usr/bin/env bash
# Reproducible Arc Testnet deploy for TreasuryPolicyExecutor.
# Prereqs: foundry installed; .env at repo root with DEPLOYER_PRIVATE_KEY
# (funded with Arc USDC gas via https://faucet.circle.com), ARC_RPC_URL,
# ARC_USDC_ADDRESS, DEMO_VAULT_ADDRESS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a

: "${ARC_RPC_URL:?set ARC_RPC_URL}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY (testnet only)}"
: "${ARC_USDC_ADDRESS:?set ARC_USDC_ADDRESS}"
: "${DEMO_VAULT_ADDRESS:?set DEMO_VAULT_ADDRESS}"

cd "$(dirname "$0")"
echo "Deploying to Arc Testnet ($ARC_RPC_URL)..."
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_RPC_URL" \
  --broadcast \
  --skip-simulation \
  -vvv | tee /tmp/arctreasury-deploy.log

ADDR=$(grep "TreasuryPolicyExecutor:" /tmp/arctreasury-deploy.log | tail -1 | awk '{print $2}')
mkdir -p deployments
forge inspect src/TreasuryPolicyExecutor.sol:TreasuryPolicyExecutor abi > deployments/TreasuryPolicyExecutor.abi.json
cat > deployments/arc-testnet.json <<EOF
{
  "network": "arc-testnet",
  "chainId": 5042002,
  "contract": "TreasuryPolicyExecutor",
  "address": "$ADDR",
  "usdc": "$ARC_USDC_ADDRESS",
  "vault": "$DEMO_VAULT_ADDRESS",
  "explorer": "https://testnet.arcscan.app/address/$ADDR",
  "abiFile": "TreasuryPolicyExecutor.abi.json"
}
EOF
echo "Saved deployments/arc-testnet.json (address $ADDR)"
echo "Set TREASURY_EXECUTOR_ADDRESS=$ADDR in your .env to enable CHAIN_MODE=arc-testnet."
