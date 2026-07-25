import { cmp } from "./money.js";
import { hashValue } from "./hash.js";
import { runForecast, seriesFor } from "./forecast.js";
import { actionToTransfers } from "./optimizer.js";
import { fmt } from "./util.js";
import type {
  LiquidityAction,
  PolicyCheck,
  PolicyEvaluation,
  PolicyVersion,
  TreasuryScenarioData,
} from "./entities.js";

/**
 * Deterministic, versioned policy engine. Independent of any LLM. Every check
 * returns a structured record with the observed value, threshold, and evidence.
 * A failed MANDATORY rule makes the proposal non-approvable. Re-run immediately
 * before execution; a changed result hash invalidates a prior approval.
 */
export function evaluatePolicy(
  data: TreasuryScenarioData,
  action: LiquidityAction,
  policy: PolicyVersion = data.policy,
  evaluatedAt: number = data.asOf
): PolicyEvaluation {
  const t = policy.thresholds;
  const v = policy.version;
  const checks: PolicyCheck[] = [];

  const add = (
    ruleId: string,
    status: PolicyCheck["status"],
    observedValue: string,
    threshold: string,
    unit: string,
    reason: string,
    evidenceRefs: string[] = []
  ) => checks.push({ ruleId, policyVersion: v, status, observedValue, threshold, unit, reason, evidenceRefs });

  // Single-transaction cap.
  add(
    "max_single_transaction",
    cmp(action.amount, t.maxSingleTransaction) <= 0 ? "pass" : "fail",
    fmt(action.amount),
    fmt(t.maxSingleTransaction),
    "USDC",
    "Amount must not exceed the per-transaction cap.",
    [action.railId]
  );

  // Daily aggregate (single action here; treated as the day's aggregate).
  add(
    "max_daily_aggregate",
    cmp(action.amount, t.maxDailyAggregate) <= 0 ? "pass" : "fail",
    fmt(action.amount),
    fmt(t.maxDailyAggregate),
    "USDC",
    "Aggregate daily movement must not exceed the daily cap."
  );

  // Destination allowlist.
  const destPool = data.pools.find((p) => p.id === action.destPoolId);
  const destAddr = destPool?.walletAddress.toLowerCase() ?? "(unknown)";
  const allow = t.approvedDestinations.map((a) => a.toLowerCase());
  add(
    "approved_destination",
    allow.includes(destAddr) ? "pass" : "fail",
    destAddr,
    `${t.approvedDestinations.length} allowlisted`,
    "address",
    "Destination must be on the approved allowlist.",
    t.approvedDestinations
  );

  // Approved instrument.
  add(
    "approved_instrument",
    t.approvedInstruments.includes(action.railId) ? "pass" : "fail",
    action.railId,
    t.approvedInstruments.join(","),
    "railId",
    "Only approved settlement instruments may be used."
  );

  // Settlement coverage under downside, with the action applied.
  const post = runForecast(data, {
    scenario: "downside",
    horizonHours: 48,
    stepSeconds: 3600,
    extraTransfers: actionToTransfers(data, action),
  });
  const destSeries = seriesFor(post, action.destPoolId);
  const coverageOk = cmp(destSeries.minBalance, destPool!.stressedReserve) >= 0;
  add(
    "min_settlement_coverage",
    coverageOk ? "pass" : "fail",
    fmt(destSeries.minBalance),
    fmt(destPool!.stressedReserve),
    "USDC",
    "Destination must stay above its stressed reserve across the horizon (>= 100% coverage)."
  );

  // Source not starved.
  const srcSeries = seriesFor(post, action.sourcePoolId);
  const srcPool = data.pools.find((p) => p.id === action.sourcePoolId)!;
  add(
    "source_reserve_protected",
    cmp(srcSeries.minBalance, srcPool.stressedReserve) >= 0 ? "pass" : "fail",
    fmt(srcSeries.minBalance),
    fmt(srcPool.stressedReserve),
    "USDC",
    "Source wallet must remain above its own stressed reserve after the transfer."
  );

  // Two-person approval advisory (warning, not a hard fail here).
  add(
    "two_person_threshold",
    cmp(action.amount, t.twoPersonThreshold) > 0 ? "warning" : "pass",
    fmt(action.amount),
    fmt(t.twoPersonThreshold),
    "USDC",
    "Amounts above the threshold should require a second approver."
  );

  const approvable = checks.every((c) => c.status !== "fail");
  const resultHash = hashValue({
    policyVersion: v,
    action,
    checks: checks.map((c) => ({ ruleId: c.ruleId, status: c.status })),
  });

  return { policyVersion: v, evaluatedAt, checks, approvable, resultHash };
}
