# ArcTreasury

[![CI](https://github.com/ms1ny-hue/arctreasury/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ms1ny-hue/arctreasury/actions/workflows/ci.yml)

**Settlement-liquidity assurance for stablecoin payment companies, built on Arc.**

*Know whether every critical payout is covered before settlement time.*

**Live dashboard: https://web-one-mauve-12.vercel.app** &nbsp;·&nbsp; Contract: [`0xC43D3b40…B882B86`](https://testnet.arcscan.app/address/0xC43D3b4069B9Bd19C6E24e293aE81E79bB882B86) &nbsp;·&nbsp; [Circle-signed execute tx](https://testnet.arcscan.app/tx/0xb3003de10d83b97ab0082d6822fcf86af17329695958ea149498e593918e9e4d)

ArcTreasury sits between forecasting/data systems and custody/settlement rails as
the decisioning and orchestration layer for stablecoin settlement liquidity. It
predicts corridor- and wallet-level funding needs, protects upcoming merchant and
payout obligations, finds trapped or excess USDC, and prepares governed liquidity
moves across approved settlement accounts.

> **Core thesis (non-negotiable):** AI may analyze, explain, and prepare treasury
> actions. It may never independently execute a financial transaction. Execution
> stays behind deterministic policy controls, limits, and a persistent,
> concurrency-safe human-approval workflow.

A programmable treasury control and settlement layer for stablecoin payment companies,
submitted in the **DeFi track** of the Programmable Money Hackathon (Encode × Arc × Circle).
(The on-chain executor is a governed settlement contract, not a DeFi protocol.)

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

The signature output is a **Settlement Coverage Certificate**: a deterministically
verified, tamper-evident evidence bundle for a proposed liquidity action, whose
SHA-256 integrity commitment is anchored on Arc. Anyone holding the private bundle
can confirm it is unchanged since commitment, without revealing any treasury data.

**What the on-chain commitment does and does not establish.** It establishes
tamper-evidence (the evidence has not changed since it was committed) and that the
approval and execution controls in the contract were satisfied. It does **not**
prove the truth of the private balances, obligations, or the coverage calculation
itself; that is verified off-chain by a separate deterministic verifier (a second implementation, same codebase).
We therefore call it an attestation and integrity commitment, not a cryptographic
proof of coverage.

## Signing and approval model (precise)

Human approval is enforced server-side through a persistent, concurrency-safe
workflow (Postgres state transitions with compare-and-set, one approval per
proposal) plus a separate deterministic verifier. On-chain, one **Circle developer-controlled
wallet** (Arc Testnet) mechanically signs the `register`, `approve`, and `execute`
calls; the deployed application holds **no raw private key**. Approval and execution
are therefore **not** signer-separated on-chain: we do not claim on-chain
maker/checker, cryptographic separation of approval and execution, or independent
approval keys. The contract still enforces its ordering (a proposal must be approved
before it can execute), allowlists, per-transaction cap, expiry, single-execution,
replay, and deploy-chain guards, and settlement is confirmed from on-chain state
(`getProposal.executed`), never from a provider's response alone.

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
rails. Execution runs through a **customer-controlled execution vault**: the deployed
application stores no raw signing key, and the on-chain contract governs only the ERC-20
balance it custodies (it holds and transfers that balance — it is not a claim of zero custody).

---

## Architecture

TypeScript-first pnpm monorepo (modular monolith, not microservices).

```
packages/
  config/     Verified Arc Testnet constants + typed, validated env (zod)
  domain/     The engine: money, forecast, policy, optimizer + separate deterministic verifier,
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

## API — arbitrary datasets (not a scripted demo)

The engine is a pure function of its input. Submit any payment company's
settlement position through the ingestion boundary and get its own result.

```bash
# 1. Fetch the example dataset (the fixture in external format)
curl -s https://web-one-mauve-12.vercel.app/api/dataset/example > dataset.json

# 2. Edit any field (a balance, an obligation amount, a rail's arrival time),
#    then run the engine over YOUR dataset — no code change:
curl -s -X POST https://web-one-mauve-12.vercel.app/api/pipeline \
  -H 'content-type: application/json' \
  -d "{\"dataset\": $(cat dataset.json), \"scenario\": \"downside\"}" | jq .recommendation.amount
```

Changing an obligation changes the required amount; pushing a rail's conservative
arrival past the shortfall deadline makes the verifier reject the route. Malformed
input is rejected with field-level errors (HTTP 422). See `apps/web/public/openapi.yaml`
([live](https://web-one-mauve-12.vercel.app/openapi.yaml)) for the full schema.

Independence: ArcTreasury is an independent hackathon project, not affiliated with
or endorsed by any sponsor or employer.

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
# TypeScript domain + engine (36 tests incl. property-based)
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

**Live and verified now:**

- Real Arc Testnet reads through the public RPC: latest block and USDC balances
  (`packages/chain/src/arc.ts`). Verified against chain ID 5042002 at block ~53.6M.
- Confirmed on-chain behavior used in code: Arc's USDC precompile
  (`0x3600000000000000000000000000000000000000`) implements `balanceOf` at 6 decimals but
  reverts on `decimals()`/`symbol()`; the gateway accounts for this instead of guessing.
- All network-specific values (chain id, RPC, USDC and other contract addresses, explorer,
  faucet) live in typed configuration sourced from the official Arc docs, not invented.

**Deployed and executed live on Arc Testnet, signed by a Circle developer-controlled wallet:**

- `TreasuryPolicyExecutor` deployed at
  [`0xC43D3b4069B9Bd19C6E24e293aE81E79bB882B86`](https://testnet.arcscan.app/address/0xC43D3b4069B9Bd19C6E24e293aE81E79bB882B86).
- A full governed lifecycle ran on-chain from the deployed app — register, approve, execute —
  all signed by a **Circle developer-controlled wallet** (`0xc72c715d…`, `ARC-TESTNET`) via
  `POST /v1/w3s/developer/transactions/contractExecution` (Circle tx `307d410c…`, state COMPLETE).
  The execute transaction moved USDC through the executor to the allowlisted vault:
  [`0xb3003de10d83b97ab0082d6822fcf86af17329695958ea149498e593918e9e4d`](https://testnet.arcscan.app/tx/0xb3003de10d83b97ab0082d6822fcf86af17329695958ea149498e593918e9e4d)
  (block 54201300).
- The private Settlement Coverage Certificate hashes (SHA-256) to the exact `bytes32`
  committed on-chain (`0xf968431140c7…780bdf0e`), verified `true` after execution — the same
  commitment shown on the homepage, produced deterministically. Tamper-evidence, not proof of
  input truth.
- Human approval is enforced server-side (persistent, concurrency-safe workflow); the one
  Circle wallet then mechanically signs register/approve/execute. Approval and execution are
  **not** signer-separated on-chain.
- Full evidence — every transaction hash, the ABI, and the prior (historical) lifecycle — is in
  `packages/contracts/deployments/arc-testnet.json`.

**Circle tooling:** Circle **developer-controlled wallets** sign every on-chain settlement (Arc
Testnet); Arc USDC is the settlement asset and native gas token; Circle faucet funds testnet
USDC. CCTP (`TokenMessengerV2`) and Gateway addresses are captured in config as a **roadmap**
funding rail — not part of the core submission. No permissioned products (StableFX, USYC, Circle
Payments Network) are claimed.

## Real vs simulated

| Component | Status |
|-----------|--------|
| Arc Testnet block + USDC balance reads | **Live** |
| Smart contract deployed to Arc Testnet | **Live** (`0x320EbA17...e299122`) |
| On-chain register / approve / execute + explorer receipts | **Live** (execute tx `0x11532a10...69ce5090`) |
| Certificate commitment verified against on-chain `bytes32` | **Live** (matches `true`) |
| Forecast, policy, optimizer, verifier, certificate, shadow-mode | Real code, **simulated** Northstar dataset |
| Read/propose-only MCP server | **Live** (`apps/mcp`, 11 tools, no approve/sign/execute) |
| Runtime AI explanations | **Live** (`packages/ai`, schema-constrained Claude + deterministic fallback) |
| CCTP funding rail | **Wired** (`FundingGateway` + demo/CCTP adapters, real domains + TokenMessengerV2); live burn/mint pending source-chain USDC |
| Postgres data model + REST API | Planned P1, not built yet |

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
