#!/usr/bin/env -S npx tsx
/**
 * ArcTreasury MCP server — READ and PROPOSE only.
 *
 * MCP tools are model-controlled, so this server deliberately exposes no
 * approve, sign, submit, transfer, settle, or execute tool. It reads treasury
 * state, runs the same deterministic domain engine as the REST API, and reads
 * persisted proposal/reconciliation status from the indexer's durable store.
 * Human approval and on-chain execution happen outside this surface.
 *
 * Prompt-injection posture: all string inputs are DATA, never instructions.
 * Identifiers are validated against known entities.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  northstarScenario,
  runForecast,
  seriesFor,
  recommendRebalance,
  verifyAction,
  evaluatePolicy,
  buildCertificate,
  certificateSimHash,
  resolveArrival,
  hashValue,
  format,
  humanUtc,
  type Money,
} from "@arctreasury/domain";
import { proposalStatus, reconciliationStatus, reconAvailable } from "./recon.js";

const data = northstarScenario();
const SESSION_ID = randomUUID();

const isMoney = (v: unknown): v is Money => !!v && typeof v === "object" && "amount" in v && "currency" in v;
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (isMoney(x) ? format(x) : typeof x === "bigint" ? x.toString() : x), 2);
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : j(v) }] });
const provenance = (tool: string, input: unknown, result: unknown) => ({
  actorId: "mcp-client", sessionId: SESSION_ID, toolCallId: randomUUID(),
  inputHash: hashValue(input), resultHash: hashValue(result), timestamp: new Date().toISOString(),
});
const poolIds = () => data.pools.map((p) => p.id);
const PoolId = z.string().max(64).refine((id) => poolIds().includes(id), { message: "unknown poolId" });
const Pid = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 proposal id");

const server = new McpServer({ name: "arctreasury", version: "0.3.0" });

server.tool("get_live_accounts", "Settlement accounts/wallets and their balances and reserves.", {}, async () =>
  text({
    account: data.accountId, dataStatus: data.dataStatus,
    note: "Demo dataset (Northstar). External datasets enter via the REST ingestion API; live balances would come from an Arc/Circle account adapter.",
    accounts: data.pools.map((p) => ({ id: p.id, label: p.label, wallet: p.walletAddress, balance: p.balance, operatingReserve: p.operatingReserve, stressedReserve: p.stressedReserve })),
  })
);

server.tool("list_obligations", "Merchant and payout obligations the forecast must keep covered.", {}, async () =>
  text(data.obligations.map((o) => ({ id: o.id, kind: o.kind, amount: o.amount, dueAt: humanUtc(o.dueAt), mandatory: o.mandatory, poolId: o.poolId, description: o.description })))
);

server.tool("detect_shortfall", "Forecast a stress scenario and report the earliest projected shortfall.", { scenario: z.enum(["base", "downside", "severe"]).default("downside"), poolId: PoolId.default("pool-eu") }, async ({ scenario, poolId }) => {
  const s = seriesFor(runForecast(data, { scenario, horizonHours: 48, stepSeconds: 3600 }), poolId);
  return text({ scenario, poolId, minBalance: s.minBalance, shortfallAt: s.timeToShortfallSec === null ? null : humanUtc(data.asOf + s.timeToShortfallSec), requiredTopUp: s.requiredTopUp });
});

server.tool("recommend_rebalance", "PROPOSE the smallest safe funding action (no execution). Read-only analysis.", { sourcePoolId: PoolId.default("pool-us"), destPoolId: PoolId.default("pool-eu") }, async (input) => {
  const rec = recommendRebalance(data, input);
  const arrival = resolveArrival(data, rec.action);
  const result = { authoritativeAmount: rec.authoritativeAmount, maxSafeAmount: rec.maxSafeAmount, sizingMethod: "analytically minimal · single route", conservativeArrivalAt: humanUtc(arrival.arrivalAt), latestSafeExecutionAt: humanUtc(rec.latestSafeExecutionAt), bindingConstraint: rec.bindingConstraint, rail: rec.action.railId, note: "A recommendation, not an approval or execution. A human approves and settles outside MCP." };
  return text({ ...result, provenance: provenance("recommend_rebalance", input, result) });
});

server.tool("verify_recommendation", "Independently verify coverage + arrival timing and the deterministic policy for a candidate route.", { sourcePoolId: PoolId.default("pool-us"), destPoolId: PoolId.default("pool-eu") }, async (input) => {
  const rec = recommendRebalance(data, input);
  const verification = verifyAction(data, rec.action);
  const policy = evaluatePolicy(data, rec.action);
  const result = { verifierPassed: verification.passed, policyApprovable: policy.approvable, checks: verification.checks, policyChecks: policy.checks.map((c) => ({ ruleId: c.ruleId, status: c.status })) };
  return text({ ...result, provenance: provenance("verify_recommendation", input, result) });
});

server.tool("get_proposal_status", "Persisted on-chain lifecycle (registered/approved/executed) for a proposal id, from the indexer store.", { proposalId: Pid }, async ({ proposalId }) => text(await proposalStatus(proposalId)));

server.tool("get_reconciliation_status", "Reconciliation result (pending/matched/mismatched/failed/reorged) for a proposal id, from the indexer store.", { proposalId: Pid }, async ({ proposalId }) => text(await reconciliationStatus(proposalId)));

server.tool("get_audit_evidence", "The tamper-evident evidence bundle for the recommended action (hashes + attestation commitment).", { sourcePoolId: PoolId.default("pool-us"), destPoolId: PoolId.default("pool-eu") }, async (input) => {
  const rec = recommendRebalance(data, input);
  const pol = evaluatePolicy(data, rec.action);
  const cert = buildCertificate(data, rec, pol, certificateSimHash(rec));
  return text({ certificateId: cert.certificateId, attestationCommitment: cert.commitment, inputSnapshotHash: rec.inputSnapshotHash, policyHash: pol.resultHash, forecastHash: rec.forecastHash, coveredObligations: rec.coveredObligationIds, note: "Tamper-evident integrity commitment; not a proof of the truth of private inputs." });
});

async function main() {
  await server.connect(new StdioServerTransport());
  process.stderr.write(`arctreasury MCP (read/propose-only) ready · indexer store ${reconAvailable() ? "present" : "absent"}\n`);
}
main().catch((e) => { process.stderr.write(`fatal: ${(e as Error).message}\n`); process.exit(1); });
