# Architecture

## Shape

A TypeScript-first pnpm monorepo, built as a modular monolith. No Kafka, no
Kubernetes, no microservices, no distributed workflow engine. The intellectual
core is a pure, deterministic domain package with no I/O; everything else depends
on it.

```
config  ->  domain  ->  chain  ->  apps (demo, web)
                    \->  contracts (independent Foundry project)
```

## Packages

### `@arctreasury/config`
Verified Arc Testnet constants (chain id 5042002, RPC, explorer, USDC and other
contract addresses, faucet) sourced from the official Arc docs, plus a zod-validated
environment loader that fails fast at startup. `arc-testnet` mode requires the deployed
executor address; `demo` mode requires nothing.

### `@arctreasury/domain` (the engine)
Pure, deterministic, no I/O. Modules:

- **money** — integer atomic units (`bigint`) with currency and decimals. No floating
  point anywhere. Exact decimal-string parse/format, rational scaling, dollar-hours.
- **entities** — every domain type. Timestamps are epoch seconds so the engine is
  fully deterministic and hashable.
- **hash** — canonical JSON (sorted keys, tagged bigints) and SHA-256. One documented
  hash choice used consistently.
- **seed** — the Northstar Pay scenario with a fixed clock.
- **forecast** — hourly 48h and daily 14d engine. Scenario shocks (base, downside,
  severe) are explicit transforms. Produces min balance, time to shortfall, required
  top-up, and max safe release per pool.
- **policy** — deterministic, versioned rule engine, independent of any LLM. Each check
  returns a structured record with observed value, threshold, and evidence.
- **optimizer** — computes the smallest safe rebalance and the policy-bounded maximum.
  For a single source-to-destination move the minimal amount is provably the downside
  required top-up, so the status is `optimal` when feasible.
- **verifier** — an independent second calculation. Recomputes every constraint from
  raw data with the proposed action applied, trusting neither the optimizer nor its
  hashes. A proposal proceeds only if this passes.
- **certificate** — builds the Settlement Coverage Certificate, computes its SHA-256
  commitment, and verifies a private certificate against an on-chain commitment.
- **shadow** — counterfactual ROI against a static-buffer baseline, every number with
  a formula and assumptions, nothing fabricated or annualized.
- **proposal** — the state machine (draft, evaluated, awaiting_approval, approved,
  executing, settled, failed, expired, invalidated) plus an append-only audit hash-chain
  and the approval-invalidation logic.

### `@arctreasury/chain`
The `ChainGateway` interface abstracts the execution rail. `ArcTestnetGateway` uses viem
for real reads, simulation, writes, and receipts. `DemoGateway` is deterministic and can
never be confused with the live path. `FundingGateway` (CCTP/App Kit) is defined for P1.

### `packages/contracts`
`TreasuryPolicyExecutor.sol`, a small auditable Foundry project. See THREAT_MODEL.md for
the control perimeter.

### `apps/demo` and `apps/web`
The demo is a CLI that runs the whole vertical slice. The web app is a Next.js App Router
dashboard whose page is a server component that runs the domain pipeline and performs a
live Arc read, then renders it.

## Data flow for one action

1. Load scenario (balances, obligations, cash flows, rails, policy) with a data-status label.
2. Run the deterministic forecast for base, downside, and severe scenarios.
3. Optimizer computes the smallest safe rebalance and the policy-bounded maximum.
4. Independent verifier recomputes coverage from raw data and must pass.
5. Policy engine evaluates every rule; a failed mandatory rule blocks approval.
6. Build the Settlement Coverage Certificate and its SHA-256 commitment.
7. Create the proposal; it reaches `awaiting_approval` only if policy is approvable and the
   verifier passed. It binds a snapshot of critical hashes.
8. Human approves. If any bound hash changed, the approval is invalidated.
9. Pre-execution guard re-checks state, expiry, and every bound hash.
10. Execute over the Arc rail; persist the receipt; verify the certificate commitment on-chain.
11. On a delayed or failed route, replan into a new proposal without repeating execution.

## Determinism and hashing

Identical inputs and scenario produce identical output and identical hashes on any machine.
This is what makes the shadow-mode counterfactual replayable and the certificate independently
verifiable. The certificate commitment is SHA-256 over the canonical JSON of the certificate
body; it is published on Arc as a `bytes32`. The contract never recomputes it. Any holder of
the private certificate recomputes the hash and compares.

## Technology choices

Next.js App Router, React Server Components for the data-heavy dashboard, TypeScript strict
mode, viem for EVM reads/writes/simulation, Foundry with OpenZeppelin for the contract, Vitest
and fast-check for the engine, zod at trust boundaries. Postgres/Drizzle and a versioned REST
API (OpenAPI 3.1) are the next layer; at Checkpoint 2 the engine is the persistence-free core.
