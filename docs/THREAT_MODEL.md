# Threat Model

## Smart-contract control perimeter

`TreasuryPolicyExecutor` governs ONLY the ERC-20 balance it custodies and the
permissions defined in it. It has no authority over external bank, custodian, or
exchange accounts. Only opaque commitments (policy hash, input hash, certificate
commitment) and the minimum execution data (token, destination, amount, expiry) are
written on-chain. No balances, forecasts, counterparties, corridors, or payout
schedules are ever published to the chain.

## On-chain vs off-chain controls (explicit)

**Enforced on-chain** by `TreasuryPolicyExecutor`: token + destination allowlists,
per-transaction cap, expiry, approval ordering (a proposal must be approved before it
executes), single-execution, replay guard, deploy-chain guard, pause, and role checks.

**Enforced off-chain** (application + engine, NOT on-chain): the daily aggregate limit,
the two-person-review threshold (advisory), the coverage calculation, the separate
deterministic verifier, and the human-approval workflow itself. These are not on the
chain and are not cryptographically enforced by the contract. The on-chain commitment
attests that the off-chain evidence is unchanged; it does not prove the off-chain
controls ran.

## Trust boundaries

- All external input (CSV, counterparty metadata, transaction memos, API responses)
  is untrusted DATA, never instructions. This matters specifically for prompt injection
  against any future AI or MCP surface.
- zod validates at every boundary. Money crossing the chain boundary is rescaled
  explicitly using the token's on-chain scale.

## Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Key compromise | Production signing uses a Circle developer-controlled wallet (Arc Testnet); the deployed app holds no raw private key (browser, repo, DB, or logs). One Circle wallet signs register/approve/execute — approval is NOT signer-separated on-chain; it is enforced server-side (Postgres compare-and-set, one approval per proposal) plus an independent verifier. Contract ordering (approve-before-execute), allowlist, cap, expiry, single-execution, and a pause switch still apply. |
| Malicious destination | Destination allowlist enforced at registration and re-checked at execution. |
| Stale forecast / manipulated inputs | Data-freshness assertions with per-source thresholds; approval binds input, forecast, route, policy, and simulation hashes; any change invalidates approval. |
| AI overreach | AI cannot alter balances, forecasts, or policy results, compute the authoritative amount, approve, sign, or call the execution gateway. It only summarizes validated data. |
| Prompt injection | Uploaded content and memos are treated as data. MCP server (P1) is read/propose-only; every MCP proposal enters `awaiting_approval`. |
| Replay | Per-proposal id uniqueness; re-registration reverts. |
| Double execution | `executed` flag set before the external transfer (checks-effects-interactions); second execution reverts. Verified by a Foundry conservation invariant across 2048 randomized calls. |
| Chain switching | Executor stores its deploy chain id and reverts execution on any other chain. Config enforces the expected Arc chain. |
| RPC failure | Reads degrade gracefully; the UI shows a disconnected state honestly rather than faking data. |
| Bridge / counterparty / partial failure | Rails carry health, finality, and failure semantics; funds are never counted before economic availability; delayed routes trigger replanning, not duplicate execution. |
| Stuck or ambiguous transaction | Non-idempotent writes are never blindly retried; execution is idempotent per proposal id; state machine has explicit failed/expired/invalidated terminals. |
| Misleading UI | Persistent environment badge (Arc Testnet / Simulation / Demo Data); every value carries provenance; test funds are never implied to have value. |
| Unauthorized policy change / insider approval abuse | Policies are versioned; approval is attributable; large amounts raise an advisory two-person-review flag (not an on-chain enforced second signer); the audit log is an append-only hash-chain. On-chain signer separation of approval and execution is not implemented in this build (single Circle wallet). |
| Amount-limit violation | Per-transaction cap enforced in the contract and re-checked independently by the verifier and policy engine. |

## Pre-execution re-checks

Immediately before touching the chain, the engine re-reads and re-validates state, expiry,
and every bound hash. A mismatch blocks execution with a reason rather than proceeding.

## Secrets

No private keys, API keys, entity secrets, or seed phrases are committed. `.env` is
gitignored; `.env.example` carries only public Arc values. The deploy key is testnet-only,
supplied out-of-band, and used exclusively by the deploy/execution scripts, never by the browser.

## Disclaimer

Prototype and testnet software. Not investment advice, not production treasury infrastructure.
