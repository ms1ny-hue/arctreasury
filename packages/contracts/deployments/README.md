# Deployments

`arc-testnet.json` and `TreasuryPolicyExecutor.abi.json` are written here by
`./deploy.sh` after a successful Arc Testnet deployment. They contain only
public data (address, ABI, chain id, explorer link) — never secrets.

Status at Checkpoint 2: contract is compiled and fully tested (17/17 Foundry
tests, including a conservation invariant). On-chain deployment is a single
`pnpm contracts:deploy` away and is gated only on funding a testnet deployer
key with Arc USDC gas from https://faucet.circle.com. Once deployed, this
folder is committed and the address is surfaced in the README and dashboard.
