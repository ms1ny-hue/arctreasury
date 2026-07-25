# API

## Status at Checkpoint 2

The domain engine is a persistence-free library. At this checkpoint it is consumed
directly by the CLI (`apps/demo`) and by the dashboard's server components
(`apps/web`), not yet exposed as a standalone HTTP service. The REST surface below is
the planned P1 contract that will wrap the same engine functions once the Postgres data
model (Drizzle) is in place. It is documented here so the shape is fixed; it is not
claimed to be live.

## Conventions (planned)

- Versioned, resource-oriented routes under `/api/v1`.
- zod validation at every boundary; consistent response envelope with success flag, data,
  error, and pagination metadata.
- `201 Created` plus `Location` for new resources; `409 Conflict` for illegal state
  transitions and for idempotency-key reuse with a different payload; `422` for semantic
  validation errors. Idempotency keys on all financial mutations. Request and trace ids.

## Planned endpoints

```
GET    /api/v1/treasury-accounts/:id/snapshot
GET    /api/v1/treasury-accounts/:id/cash-flow-events
GET    /api/v1/treasury-accounts/:id/settlement-obligations
POST   /api/v1/treasury-accounts/:id/settlement-obligation-imports
GET    /api/v1/treasury-accounts/:id/liquidity-pools
GET    /api/v1/treasury-accounts/:id/funding-rails
GET    /api/v1/treasury-accounts/:id/rail-availability
POST   /api/v1/treasury-accounts/:id/forecast-runs
GET    /api/v1/forecast-runs/:id
GET    /api/v1/treasury-accounts/:id/policies/current
POST   /api/v1/treasury-accounts/:id/liquidity-recommendations
POST   /api/v1/recommendations/:id/policy-evaluations
POST   /api/v1/recommendations/:id/proposals
GET    /api/v1/proposals/:id
POST   /api/v1/proposals/:id/approvals
POST   /api/v1/proposals/:id/executions
GET    /api/v1/proposals/:id/audit-events
GET    /api/v1/proposals/:id/settlement-coverage-certificate
POST   /api/v1/settlement-coverage-certificates/:id/verify
POST   /api/v1/shadow-runs
GET    /api/v1/shadow-runs/:id
```

## Engine functions available now

Each planned endpoint maps to an existing, tested engine function:

| Endpoint | Engine function (`@arctreasury/domain`) |
|----------|------------------------------------------|
| forecast-runs | `runForecast` |
| liquidity-recommendations | `recommendRebalance` |
| policy-evaluations | `evaluatePolicy` |
| proposals / approvals / executions | `createProposal`, `approveProposal`, `guardExecution`, `beginExecution`, `settleExecution` |
| settlement-coverage-certificate | `buildCertificate` |
| certificate verify | `verifyCertificate` |
| shadow-runs | `runShadowComparison` |
| chain reads / execution | `@arctreasury/chain` `ArcTestnetGateway` / `DemoGateway` |

The independent verifier (`verifyAction`) gates every proposal before it can reach
`awaiting_approval`.
