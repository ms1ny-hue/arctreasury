# ArcTreasury MCP Server

A read/propose-only Model Context Protocol server over the treasury engine. An
MCP client (Claude Desktop, Claude Code, any MCP host) can inspect the treasury
and DRAFT proposals, but can never approve, sign, or execute. This keeps the
core thesis intact at the agent boundary: AI analyzes and prepares; humans
approve; deterministic policy executes.

## Connect

The repository ships a project-scoped `.mcp.json`. After `pnpm install`, an MCP
host that reads project config (for example Claude Code in this directory) will
launch the server with:

```json
{ "command": "npx", "args": ["-y", "tsx", "apps/mcp/src/server.ts"] }
```

Or run it directly over stdio:

```bash
pnpm --filter @arctreasury/mcp start
```

## Tools

Read:
- `get_treasury_snapshot` — balances, pools, corridors, data status.
- `get_liquidity_forecast` — deterministic base/downside/severe forecast.
- `list_settlement_obligations` — contractual outflows to cover.
- `get_rail_availability` — rails, health, finality, cutoffs.
- `list_pending_approvals` — proposals awaiting a human.
- `get_settlement_coverage_certificate` — the certificate for a proposal.
- `verify_settlement_coverage_certificate` — recompute and compare to an on-chain commitment.
- `get_audit_record` — append-only audit hash-chain plus an integrity check.
- `run_shadow_comparison` — counterfactual ROI vs a static buffer.

Propose (never execute):
- `evaluate_liquidity_candidate` — analysis only; runs the independent verifier and policy engine for a candidate amount, creates nothing.
- `create_liquidity_proposal` — drafts the smallest safe rebalance and registers it in `awaiting_approval`.

## Not exposed (by design)

approve, sign, execute, arbitrary RPC, arbitrary contract calls, SQL, secret
access, filesystem access.

## Safety

- Every created proposal enters `awaiting_approval`.
- Each propose/evaluate result carries a provenance envelope: actor id, session
  id, tool-call id, correlation id, input hash, result hash, and timestamp.
- Prompt-injection posture: all string inputs are DATA, never instructions.
  Identifiers are validated against known entities (an injected pool id such as
  `"evil; DROP TABLE"` is rejected with an input-validation error); free text is
  length-capped and never interpreted.
