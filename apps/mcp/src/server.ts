#!/usr/bin/env -S npx tsx
/**
 * ArcTreasury MCP server (read / propose only).
 *
 * Exposes treasury analysis and proposal DRAFTING to an MCP client. It does NOT
 * expose approve, sign, execute, arbitrary RPC, arbitrary contract calls, SQL,
 * secret access, or filesystem access. Every proposal it creates enters
 * `awaiting_approval`; a human still approves and executes elsewhere.
 *
 * Prompt-injection posture: all string inputs are treated as DATA, never as
 * instructions. Identifiers are validated against known entities; free text is
 * length-capped and never interpreted. Each propose/evaluate result carries a
 * provenance envelope (actor, session, tool-call, correlation, input/result
 * hashes, timestamp).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  runForecast,
  evaluatePolicy,
  verifyAction,
  verifyCertificate,
  verifyAuditChain,
  runShadowComparison,
  fromDecimalString,
  hashValue,
  format,
  humanUtc,
  type LiquidityAction,
  type Money,
} from "@arctreasury/domain";
import { TreasuryStore } from "./store.js";

const store = new TreasuryStore();
const SESSION_ID = randomUUID();

// --- serialization: Money -> readable string, bigint -> string ---
function isMoney(v: unknown): v is Money {
  return !!v && typeof v === "object" && "amount" in v && "currency" in v && "decimals" in v;
}
function j(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (isMoney(v) ? format(v) : typeof v === "bigint" ? v.toString() : v),
    2
  );
}
function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : j(value) }] };
}

function provenance(toolName: string, input: unknown, result: unknown) {
  return {
    actorId: "mcp-client",
    sessionId: SESSION_ID,
    toolCallId: randomUUID(),
    correlationId: hashValue({ toolName, input }),
    inputHash: hashValue(input),
    resultHash: hashValue(result),
    timestamp: new Date().toISOString(),
  };
}

// Reject unknown pool ids (untrusted input treated as data, matched to entities).
const poolIds = () => store.data.pools.map((p) => p.id);
const PoolId = z.string().max(64).refine((id) => poolIds().includes(id), { message: "unknown poolId" });

const server = new McpServer({ name: "arctreasury", version: "0.2.0" });

server.tool(
  "get_treasury_snapshot",
  "Balances, pools, corridors, and data-status for the treasury account.",
  {},
  async () => text({
    accountId: store.data.accountId,
    asOf: humanUtc(store.data.asOf),
    dataStatus: store.data.dataStatus,
    pools: store.data.pools.map((p) => ({ id: p.id, label: p.label, wallet: p.walletAddress, balance: p.balance, operatingReserve: p.operatingReserve, stressedReserve: p.stressedReserve, corridorId: p.corridorId })),
    corridors: store.data.corridors,
  })
);

server.tool(
  "get_liquidity_forecast",
  "Deterministic forecast for a scenario (base|downside|severe).",
  { scenario: z.enum(["base", "downside", "severe"]), horizonHours: z.number().int().min(1).max(336).default(48), stepSeconds: z.number().int().min(3600).max(86400).default(3600) },
  async ({ scenario, horizonHours, stepSeconds }) => {
    const run = runForecast(store.data, { scenario, horizonHours, stepSeconds });
    return text({
      scenario, horizonHours,
      forecastHash: run.forecastHash,
      inputSnapshotHash: run.inputSnapshotHash,
      series: run.series.map((s) => ({ poolId: s.poolId, minBalance: s.minBalance, minBalanceAt: humanUtc(s.minBalanceAt), timeToShortfallSec: s.timeToShortfallSec, requiredTopUp: s.requiredTopUp, maxSafeRelease: s.maxSafeRelease })),
    });
  }
);

server.tool("list_settlement_obligations", "Contractual outflows the forecast must keep covered.", {}, async () =>
  text(store.data.obligations.map((o) => ({ id: o.id, kind: o.kind, amount: o.amount, dueAt: humanUtc(o.dueAt), mandatory: o.mandatory, poolId: o.poolId, description: o.description })))
);

server.tool("get_rail_availability", "Funding rails with health, finality, cutoffs, and windows.", {}, async () =>
  text({ rails: store.data.rails.map((r) => ({ id: r.id, label: r.label, health: r.health, finality: r.finalityCondition, conservativeCompletionSec: r.conservativeCompletionSec, maxSize: r.maxSize })), windows: store.data.railWindows.map((w) => ({ railId: w.railId, opensAt: humanUtc(w.opensAt), cutoffAt: humanUtc(w.cutoffAt), note: w.note })) })
);

server.tool(
  "evaluate_liquidity_candidate",
  "Analysis only: run the independent verifier and policy engine for a candidate amount WITHOUT creating a proposal.",
  { sourcePoolId: PoolId, destPoolId: PoolId, amount: z.string().max(32).regex(/^\d+(\.\d+)?$/) },
  async (input) => {
    const action: LiquidityAction = { kind: "rebalance", sourcePoolId: input.sourcePoolId, destPoolId: input.destPoolId, railId: "rail-arc-internal", amount: fromDecimalString(input.amount) };
    const verification = verifyAction(store.data, action);
    const policy = evaluatePolicy(store.data, action);
    const result = { action, verification, policy, verdict: verification.passed && policy.approvable ? "would_be_approvable" : "blocked" };
    return text({ ...result, provenance: provenance("evaluate_liquidity_candidate", input, result) });
  }
);

server.tool(
  "create_liquidity_proposal",
  "Draft the smallest safe rebalance and register it as a proposal. It ALWAYS enters awaiting_approval; this tool cannot approve or execute.",
  { sourcePoolId: PoolId, destPoolId: PoolId },
  async (input) => {
    const s = store.createProposalFromRoute(input.sourcePoolId, input.destPoolId);
    const result = {
      proposalId: s.proposal.id,
      state: s.proposal.state,
      action: s.proposal.action,
      authoritativeAmount: s.recommendation.authoritativeAmount,
      bindingConstraint: s.recommendation.bindingConstraint,
      approvable: s.policyEvaluation.approvable,
      verifierPassed: s.verification.passed,
      certificateId: s.certificate.certificateId,
      certificateCommitment: s.certificate.commitment,
      note: "Human approval and execution happen outside this MCP surface.",
    };
    return text({ ...result, provenance: provenance("create_liquidity_proposal", input, result) });
  }
);

server.tool("list_pending_approvals", "Proposals awaiting human approval.", {}, async () =>
  text(store.listPending().map((s) => ({ proposalId: s.proposal.id, state: s.proposal.state, amount: s.recommendation.authoritativeAmount, dest: s.proposal.action.destPoolId, expiresAt: humanUtc(s.proposal.expiresAt) })))
);

server.tool(
  "get_settlement_coverage_certificate",
  "The certificate for a proposal (canonical fields + commitment).",
  { proposalId: z.string().max(96) },
  async ({ proposalId }) => {
    const s = store.get(proposalId);
    if (!s) return text({ error: "unknown proposalId" });
    return text(s.certificate);
  }
);

server.tool(
  "verify_settlement_coverage_certificate",
  "Recompute the certificate commitment and optionally compare to an on-chain bytes32.",
  { proposalId: z.string().max(96), onchainCommitment: z.string().max(66).optional() },
  async ({ proposalId, onchainCommitment }) => {
    const s = store.get(proposalId);
    if (!s) return text({ error: "unknown proposalId" });
    return text(verifyCertificate(s.certificate, onchainCommitment));
  }
);

server.tool(
  "get_audit_record",
  "Append-only audit hash-chain for a proposal, plus an integrity check.",
  { proposalId: z.string().max(96) },
  async ({ proposalId }) => {
    const s = store.get(proposalId);
    if (!s) return text({ error: "unknown proposalId" });
    return text({ audit: s.proposal.audit, chainIntact: verifyAuditChain(s.proposal.audit) });
  }
);

server.tool(
  "run_shadow_comparison",
  "Counterfactual ROI vs a static-buffer baseline. No money moves.",
  { staticBuffer: z.string().max(32).regex(/^\d+(\.\d+)?$/).default("3000000") },
  async ({ staticBuffer }) => {
    const s = store.createProposalFromRoute("pool-us", "pool-eu");
    return text(runShadowComparison(store.data, s.recommendation, { staticBuffer: fromDecimalString(staticBuffer) }));
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only; stdout is the MCP channel.
  process.stderr.write("arctreasury MCP server (read/propose-only) ready\n");
}
main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
