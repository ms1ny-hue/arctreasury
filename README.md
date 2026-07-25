# ArcTreasury

**Settlement-liquidity control plane for stablecoin payment companies, built on Arc.**

ArcTreasury sits between forecasting/data systems and custody/settlement rails as
the decisioning and orchestration layer for stablecoin settlement liquidity. It
predicts corridor- and wallet-level funding needs, protects upcoming merchant and
payout obligations, finds trapped or excess USDC, and prepares governed liquidity
moves across approved settlement accounts.

> **Core thesis (non-negotiable):** AI may analyze, explain, and prepare treasury
> actions. It may never independently execute a financial transaction. Execution
> stays behind deterministic policy controls, limits, and human cryptographic
> approval.

Programmable Money Hackathon (Encode x Arc x Circle). **DeFi track.** Checkpoint 2
(mid-submission).

---

## Problem

Cross-border PSPs, marketplaces, payroll platforms, and B2B payment providers run
settlement and payouts 24/7 across multiple counterparties and corridors. They must
prefund settlement accounts before incoming fiat or receivables arrive. The common
failure modes are two-sided: overfund and trap capital in idle buffers, or underfund
and miss an SLA-bound payout. Bank cutoffs, weekends, and delayed receivables make
the timing hard, and stablecoin rails settle around the clock even when banks do not.

## Target buyer and user

- **Buyer:** Head of Treasury, Treasurer, CFO, VP Payments, or Head of Settlement Operations.
- **Daily users:** treasury analyst and settlement-operations manager.
- **Approver:** treasury director or controller.
- **ICP:** a payments company with roughly $50M to $1B annual volume, large enough for
  liquidity inefficiency to matter, not large enough for a bank-grade treasury stack.

## The product

The urgent job: before bank cutoffs, weekends, and payout windows, determine exactly
how much liquidity each settlement wallet or corridor needs, move only what is
necessary, and produce evidence that every customer and merchant obligation stays
covered.

The signature output is not a chart or an AI paragraph. It is a machine-verifiable
**Settlement Coverage Certificate** for a proposed liquidity action, whose opaque
commitment is published on Arc so anyone can prove the private certificate matches
its on-chain commitment without revealing any treasury data.

## Why Arc, why stablecoins

Arc is a stablecoin-native L1 with USDC-denominated gas and sub-second settlement.
That is exactly what makes the core scenario solvable: when a fiat receivable is
delayed and banks are closed for the weekend, the 24/7 Arc rail can rebalance USDC
between settlement wallets in time to protect an SLA-bound payout, which a bank wire
cannot. Arc is modeled as one execution rail behind a `ChainGateway` interface, so
the commercial decision engine stays rail-neutral while Arc is the complete live path.

## Differentiation

ArcTreasury is not a competitor to Kyriba, Trovata, Fireblocks, or a general TMS. It
is the decisioning and orchestration layer that sits between those systems and the
rails. It is non-custodial: execution adapters use customer-controlled wallets or
authorized custodians, and the on-chain contract governs only the balance it custodies.

---

## Architecture

TypeScript-first pnpm monorepo (modular monolith, not microservices).

```
packages/
  config/     Verified Arc Testnet constants + typed, validated env (zod)
  domain/     The engine: money, forecast, policy, optimizer + independent verifier,
              certificate, shadow-mode, proposal state machine + audit hash-chain
  chain/      ChainGateway abstraction; ArcTestnetGateway (viem) + DemoGateway
  contracts/  TreasuryPolicyExecutor.sol (Foundry) + tests + deploy script
apps/
  demo/       CLI runner that executes the full vertical slice in the terminal
  web/        Next.js App Router dashboard (server-rendered from the domain engine)
docs/         ARCHITECTURE, THREAT_MODEL, COMMERCIAL_CASE, CUSTOMER_DISCOVERY, DEMO_SCRIPT, JUDGING
```

- **Money is never floating point.** Integer atomic units (`bigint`) with currency and
  decimals metadata throughout.
- **Deterministic engine.** Same inputs and scenario produce byte-identical output and
  identical hashes. No `Date.now()` inside the engine; the caller passes an explicit clock.
- **Two independent calculations.** The optimizer proposes an amount; a separate verifier
  recomputes coverage from raw data and must agree before anything can proceed.
- **Hashing.** SHA-256 over canonical JSON for all integrity hashes and the certificate
  commitment. The commitment is stored on-chain as `bytes32`; the contract only stores and
  emits it, and verification recomputes the hash off-chain.

## The demo scenario: Northstar Pay

A fictional PSP with two settlement wallets (EU and US). A Friday merchant settlement is
scheduled, weekend contractor payouts must stay covered, and a Friday fiat receivable is
delayed to Monday. Under the downside scenario the EU wallet breaches its stressed reserve
by 1,210,000 USDC. ArcTreasury computes the smallest safe rebalance from the US wallet
(2,010,000 USDC), independently verifies coverage, blocks an unsafe larger release, requires
human approval, executes over the Arc rail, and verifies the certificate against its on-chain
commitment. A delayed-route replan then produces a fresh proposal without repeating the
original settlement.

---

## Setup

Prerequisites: Node 20+, pnpm 11, Foundry.

```bash
pnpm install
cp .env.example .env        # public Arc Testnet values already filled; demo mode by default
```

### Run the vertical-slice demo (terminal)

```bash
pnpm demo
```

Prints the full lifecycle: live Arc read, forecast, obligation coverage, optimization,
independent verification, policy checks, coverage certificate, shadow-mode ROI, a blocked
unsafe action, human approval, Arc execution, audit evidence, certificate verification, and
failure-aware replanning.

### Run the dashboard

```bash
pnpm --filter @arctreasury/web dev
# http://localhost:3000
```

### Tests

```bash
# TypeScript domain + engine (27 tests incl. property-based)
cd packages/domain && pnpm exec vitest run

# Smart contract (17 tests: unit, fuzz, conservation invariant)
pnpm contracts:test

# Typecheck everything
pnpm -r typecheck
```

### Deploy the contract to Arc Testnet

```bash
# 1. Fund a testnet key with Arc USDC gas at https://faucet.circle.com
# 2. Put DEPLOYER_PRIVATE_KEY and DEMO_VAULT_ADDRESS in .env
pnpm contracts:deploy
# Writes packages/contracts/deployments/arc-testnet.json (address, ABI, explorer link)
# Then set TREASURY_EXECUTOR_ADDRESS in .env and CHAIN_MODE=arc-testnet
```

---

## Arc and Circle integration

**Live and verified now (Checkpoint 2):**

- Real Arc Testnet reads through the public RPC: latest block and USDC balances
  (`packages/chain/src/arc.ts`). Verified against chain ID 5042002 at block ~53.6M.
- Confirmed on-chain behavior used in code: Arc's USDC precompile
  (`0x3600000000000000000000000000000000000000`) implements `balanceOf` at 6 decimals but
  reverts on `decimals()`/`symbol()`; the gateway accounts for this instead of guessing.
- All network-specific values (chain id, RPC, USDC and other contract addresses, explorer,
  faucet) live in typed configuration sourced from the official Arc docs, not invented.

**Deployed and executed live on Arc Testnet (2026-07-25):**

- `TreasuryPolicyExecutor` deployed at
  [`0x320EbA17bf997c8D978FA32F1B834b455e299122`](https://testnet.arcscan.app/address/0x320EbA17bf997c8D978FA32F1B834b455e299122).
- A full governed lifecycle ran on-chain: register, human approve, and execute. The execute
  transaction moved USDC through the executor to the allowlisted vault:
  [`0x11532a1057344fb83beadccef522cb944f47f36e5952196276d52fba69ce5090`](https://testnet.arcscan.app/tx/0x11532a1057344fb83beadccef522cb944f47f36e5952196276d52fba69ce5090)
  (block 53619482).
- The private Settlement Coverage Certificate hashes (SHA-256) to the exact `bytes32`
  committed on-chain (`0x94477e06...1d4cfa82`), verified `true` after execution. Coverage is
  proven without publishing any treasury data.
- Full evidence, including every transaction hash and the ABI, is in
  `packages/contracts/deployments/arc-testnet.json`.

**Circle tooling:** Arc USDC as the settlement asset and native gas token; Circle faucet for
testnet USDC. CCTP (`TokenMessengerV2`) and Gateway addresses are captured in config as a P1
funding rail. No permissioned products (StableFX, USYC, Circle Payments Network) are claimed.

## Real vs simulated

| Component | Status |
|-----------|--------|
| Arc Testnet block + USDC balance reads | **Live** |
| Smart contract deployed to Arc Testnet | **Live** (`0x320EbA17...e299122`) |
| On-chain register / approve / execute + explorer receipts | **Live** (execute tx `0x11532a10...69ce5090`) |
| Certificate commitment verified against on-chain `bytes32` | **Live** (matches `true`) |
| Forecast, policy, optimizer, verifier, certificate, shadow-mode | Real code, **simulated** Northstar dataset |
| Read/propose-only MCP server | **Live** (`apps/mcp`, 11 tools, no approve/sign/execute) |
| Runtime AI explanations, CCTP funding | Planned P1, not built yet |

## Safety model

Human approval is never weakened to make the demo easier. An action reaches
`awaiting_approval` only if the deterministic policy is approvable and the independent
verifier passes. Approval binds a snapshot of critical hashes (input, forecast, route,
policy result, simulation); if any change before execution, the approval is invalidated and
the money cannot move. The contract enforces roles, allowlists, expiry, a per-transaction
cap, single execution per proposal, pause, and a deploy-chain guard.

## Limitations

Prototype and testnet software. Not investment advice, not production treasury infrastructure.
It does not replace ERP, TMS, custody, banking, sanctions screening, accounting, or
reconciliation systems, does not hold customer funds, and makes no yield claims. Savings are
counterfactual figures computed from the seed dataset with formulas shown, and are not annualized.

## Roadmap

- Runtime AI explanations with schema-constrained structured output and a deterministic fallback.
- CCTP funding flow into Arc Testnet as a treasury top-up rail.
- Persistent Postgres data model and versioned REST API (OpenAPI 3.1) behind the engine.

See `docs/` for the architecture, threat model, commercial case, customer-discovery plan,
three-minute demo script, and judging guide.
