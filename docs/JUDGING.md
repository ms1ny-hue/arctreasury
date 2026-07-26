# Judging Guide

## Twenty-second understanding

ArcTreasury is a settlement-liquidity control plane for stablecoin payment companies on
Arc. It computes the smallest safe funding action to keep every merchant and payout
obligation covered, proves it with a verifiable coverage certificate, and executes only
after human approval. AI analyzes and prepares; it never moves money.

## What to look at first

1. `pnpm demo` prints the entire vertical slice in the terminal, including a live Arc read.
2. `packages/domain` is the engine: forecast, policy, optimizer, independent verifier,
   certificate, shadow-mode, and the proposal state machine, with 27 tests.
3. `packages/contracts` is the executor with 17 Foundry tests, including a conservation
   invariant across 2048 randomized calls.
4. `apps/web` is the dashboard, server-rendered from the same engine.

## DeFi track fit

Advanced programmable-money flow: multi-step settlement (register, verify, approve, execute)
governed by on-chain policy, using USDC on Arc as the settlement asset and native gas. The
scenario shows why a stablecoin-native 24/7 rail changes what is possible: it funds an
SLA-bound weekend payout that a closed bank rail cannot.

## Truthfulness commitments

- No invented chain ids, RPC URLs, token addresses, SDK methods, transaction hashes, yields,
  or balances. Network values come from the official Arc docs and are verified live.
- Data is labeled live, testnet, simulated, or demo. No fake buttons; disabled functionality
  is explained honestly.
- Savings are computed from the dataset with formulas shown, and are not annualized.

## What is live on Arc Testnet

- Contract deployed: `TreasuryPolicyExecutor` at
  [`0x320EbA17bf997c8D978FA32F1B834b455e299122`](https://testnet.arcscan.app/address/0x320EbA17bf997c8D978FA32F1B834b455e299122).
- A full governed lifecycle executed on-chain (register, approve, execute). Verifiable execute
  transaction:
  [`0x11532a1057344fb83beadccef522cb944f47f36e5952196276d52fba69ce5090`](https://testnet.arcscan.app/tx/0x11532a1057344fb83beadccef522cb944f47f36e5952196276d52fba69ce5090).
- The private Settlement Coverage Certificate verifies `true` against the `bytes32` committed
  on-chain. All hashes and transactions are in `packages/contracts/deployments/arc-testnet.json`.
- On-chain settlement is signed by a **Circle developer-controlled wallet** (Arc Testnet); the
  deployed application holds no raw private key. Human approval is enforced server-side (Postgres
  compare-and-set + independent verifier). Approval and execution are **not** signer-separated
  on-chain (single Circle wallet signs register/approve/execute) — we do not claim on-chain
  maker/checker or cryptographic separation.
- Also live: Arc Testnet block and USDC balance reads, the full deterministic engine, the
  contract test suite, the dashboard, and the CLI.

## The signature primitive

The Settlement Coverage Certificate: a machine-verifiable record that a specific action keeps
every mandatory obligation covered under stress, with all binding hashes included. Only its
opaque SHA-256 commitment goes on-chain, so coverage is provable without publishing any
treasury data.

## Test commands

```bash
cd packages/domain && pnpm exec vitest run   # 27 pass
pnpm contracts:test                          # 17 pass (unit, fuzz, invariant)
pnpm demo                                     # full lifecycle
pnpm --filter @arctreasury/web build          # production build
```
