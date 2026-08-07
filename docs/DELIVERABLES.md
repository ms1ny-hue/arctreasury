# ArcTreasury — Encode x Arc x Circle Programmable Money Hackathon (DeFi track)

**Canonical deliverables. Single source of truth. Ignore anything that says Netlify — this project has no Netlify. Hosting is Vercel only.**

## Links (all public)

| Deliverable | URL |
|---|---|
| Live app (Vercel) | https://arctreasury-arc.vercel.app |
| Interactive workflow | https://arctreasury-arc.vercel.app/run |
| Status / diagnostics | https://arctreasury-arc.vercel.app/api/status |
| OpenAPI spec | https://arctreasury-arc.vercel.app/openapi.yaml |
| Presentation deck | https://arctreasury-arc.vercel.app/deck.html |
| Public repo | https://github.com/ms1ny-hue/arctreasury |
| Arc explorer | https://testnet.arcscan.app |

## On Arc Testnet (chainId 5042002, USDC-denominated gas)

- Contract `TreasuryPolicyExecutor`: [`0xC43D3b4069B9Bd19C6E24e293aE81E79bB882B86`](https://testnet.arcscan.app/address/0xC43D3b4069B9Bd19C6E24e293aE81E79bB882B86)
- Allowlisted settlement vault: `0xDEd1EFf0590903C82CE66F823f8317174E312f75`
- Arc USDC (native gas + settlement asset): `0x3600000000000000000000000000000000000000`

## Circle developer tooling (live)

- Circle **developer-controlled wallet** (`ARC-TESTNET`): `0xc72c715da310ae8095dffc4501b3e081244d1969`
- Circle API op used: `POST /v1/w3s/developer/transactions/contractExecution`
- Fresh Circle-signed lifecycle from the deployed app:
  - Circle tx `307d410c-55b4-5a61-a104-f02e70b75aea` → **COMPLETE**
  - Arc execute [`0xb3003de1…`](https://testnet.arcscan.app/tx/0xb3003de10d83b97ab0082d6822fcf86af17329695958ea149498e593918e9e4d)
  - `executed = true`, certificate commitment matches on-chain, reconciled MATCHED/finalized
- Also: Arc USDC as settlement asset + native gas.

## What is built

- **Domain engine** (`packages/domain`) — bigint money, deterministic forecast (base/downside/severe), versioned policy, optimizer + **separate deterministic verifier**, Settlement Coverage Certificate (SHA-256 integrity commitment), settlement-aware arrival timing, proposal state machine, audit hash-chain, external-dataset ingestion (zod). 36 tests.
- **Contract** (`packages/contracts`) — `TreasuryPolicyExecutor.sol` (AccessControl, Pausable, ReentrancyGuard, allowlists, per-tx cap, expiry, single-execution, replay + deploy-chain guards). 17 Foundry tests (fuzz + conservation invariant).
- **Signer abstraction** (`packages/chain`) — CircleSigner / LegacyPrivateKeySigner (local only) / DisabledSigner. Production signs via Circle; no raw key in the deployed app. 11 tests.
- **Persistence** — Neon Postgres, versioned migrations, compare-and-set state machine (no double approve/settle), tenant scoping, idempotency.
- **Indexer / reconciliation worker** (`apps/indexer`) — confirmation-depth finality; matches on-chain events to persisted proposals.
- **REST API** (`apps/web/app/api`) — proposals (create/approve/history), execute, status, pipeline, verify-evidence, dataset/example. OpenAPI 3.1.
- **MCP server** (`apps/mcp`) — read/propose-only, 8 tools, no approve/sign/execute.
- **Runtime AI** (`packages/ai`) — schema-constrained Claude over validated figures only; cannot compute amount / approve / execute; deterministic fallback.
- **Frontend** (`apps/web`) — landing + interactive Detect→Recommend→Verify→Approve→Settle→Audit at `/run`.

## Approval & signing model (precise, for judges)

Human approval is enforced server-side through a persistent, concurrency-safe workflow (Postgres compare-and-set, one approval per proposal) plus a separate deterministic verifier. One Circle developer-controlled wallet mechanically signs register/approve/execute on Arc. Approval and execution are **not** signer-separated on-chain; we do not claim on-chain maker/checker or cryptographic separation. The deployed app holds no raw private key. Settlement is confirmed from on-chain state, never a provider's word.

## Docs (`/docs`)

README · ARCHITECTURE · THREAT_MODEL · JUDGING · DEMO_SCRIPT · CIRCLE · API · MCP · COMMERCIAL_CASE · CUSTOMER_DISCOVERY · DELIVERABLES (this file)

## Stack

pnpm monorepo · TypeScript · Next.js 15 on **Vercel** · Neon Postgres · viem · Circle Developer-Controlled Wallets · @anthropic-ai/sdk · @modelcontextprotocol/sdk · Foundry.

## Still open (not blocking submission)

- Presentation deck — LIVE at https://arctreasury-arc.vercel.app/deck.html
- 3-minute demo video — NOT recorded (final deliverable)
- Post-hackathon: true on-chain signer separation (Option A), RBAC/auth, always-on worker, backups/PITR, load tests

## Explicitly NOT part of this project

**No Netlify. No Netlify site, config, or deploy.** Hosting is Vercel only. (The Netlify payment-simulator prototypes are a separate, unrelated repo.)
