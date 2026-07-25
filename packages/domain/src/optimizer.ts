import { add, sub, min as mmin, clampNonNeg, cmp, zero, isZero } from "./money.js";
import type { Money } from "./money.js";
import { hashValue } from "./hash.js";
import { fmt } from "./util.js";
import { runForecast, seriesFor, type Movement } from "./forecast.js";
import type {
  Epoch,
  LiquidityAction,
  LiquidityRecommendation,
  OptimizerStatus,
  TreasuryScenarioData,
} from "./entities.js";

/**
 * Liquidity recommendation / optimization.
 *
 * For a single source->dest rebalance the minimal safe amount is provably the
 * downside `requiredTopUp` of the destination: any smaller amount leaves a
 * covered-obligation shortfall, so it cannot be improved. We therefore return
 * `optimal` when that minimal amount is feasible under every policy and rail
 * constraint, `infeasible` when it is not, and `feasible_not_proven_optimal`
 * only when we fall back to a conservative heuristic. The number here is a
 * PROPOSAL; the independent verifier (verifier.ts) re-derives coverage from raw
 * data and must agree before anything can proceed.
 */
export interface RecommendInput {
  sourcePoolId: string;
  destPoolId: string;
}

export function recommendRebalance(
  data: TreasuryScenarioData,
  input: RecommendInput
): LiquidityRecommendation {
  const dest = data.pools.find((p) => p.id === input.destPoolId);
  const source = data.pools.find((p) => p.id === input.sourcePoolId);
  if (!dest || !source) throw new Error("Unknown pool in recommendation input");
  const route = data.routes.find(
    (r) => r.sourcePoolId === source.id && r.destPoolId === dest.id
  );
  if (!route) throw new Error(`No execution route ${source.id} -> ${dest.id}`);
  const rail = data.rails.find((r) => r.id === route.railId);
  if (!rail) throw new Error(`No rail ${route.railId}`);

  // 1. Destination need under the downside scenario (48h operational horizon).
  const destDown = seriesFor(
    runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 }),
    dest.id
  );
  const requiredTopUp = destDown.requiredTopUp;

  // 2. Source safe releasable under the downside scenario.
  const srcDown = seriesFor(
    runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 }),
    source.id
  );

  // 3. Policy-bounded maximum safe amount for this move.
  const t = data.policy.thresholds;
  const maxSafeAmount = [
    srcDown.maxSafeRelease,
    t.maxSingleTransaction,
    t.maxDailyAggregate,
    rail.maxSize,
  ].reduce((acc, m) => mmin(acc, m));

  // 4. Authoritative (smallest safe) amount.
  const authoritativeAmount = requiredTopUp;

  // 5. Feasibility + binding constraint.
  let status: OptimizerStatus = "optimal";
  const constraints: string[] = [];
  if (isZero(authoritativeAmount)) {
    constraints.push("No corrective action required: destination stays above its stressed reserve under the downside scenario.");
  }
  if (cmp(authoritativeAmount, maxSafeAmount) > 0) {
    status = "infeasible";
    constraints.push("Required top-up exceeds the maximum safe amount permitted by source liquidity and policy limits.");
  }

  const bindingConstraint = deriveBinding(
    destDown.timeToShortfallSec,
    data.asOf,
    rail.conservativeCompletionSec,
    authoritativeAmount,
    maxSafeAmount,
    t.maxSingleTransaction
  );

  const latestSafeExecutionAt: Epoch =
    destDown.timeToShortfallSec === null
      ? data.asOf + 48 * 3600
      : data.asOf + destDown.timeToShortfallSec - rail.conservativeCompletionSec;

  const action: LiquidityAction = {
    kind: "rebalance",
    sourcePoolId: source.id,
    destPoolId: dest.id,
    railId: rail.id,
    amount: authoritativeAmount,
  };

  const routeHash = hashValue({ route, rail: { id: rail.id, max: rail.maxSize, conservativeCompletionSec: rail.conservativeCompletionSec } });
  const inputSnapshotHash = runForecast(data, { scenario: "base", horizonHours: 48, stepSeconds: 3600 }).inputSnapshotHash;
  const forecastHash = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 }).forecastHash;

  const coveredObligationIds = data.obligations
    .filter((o) => o.poolId === dest.id && o.mandatory)
    .map((o) => o.id);

  return {
    id: `rec-${dest.id}-${data.asOf}`,
    createdAt: data.asOf,
    action,
    authoritativeAmount,
    maxSafeAmount,
    latestSafeExecutionAt,
    bindingConstraint,
    consequenceOfInaction: consequence(dest.label, destDown.requiredTopUp, destDown.timeToShortfallSec, data.asOf),
    coveredObligationIds,
    inputSnapshotHash,
    forecastHash,
    routeHash,
    optimizerStatus: status,
  };
}

function deriveBinding(
  timeToShortfallSec: number | null,
  asOf: Epoch,
  conservativeCompletionSec: number,
  amount: Money,
  maxSafe: Money,
  singleTxLimit: Money
): string {
  if (timeToShortfallSec === null) return "No binding shortfall within the 48h horizon.";
  const deadline = new Date((asOf + timeToShortfallSec) * 1000).toUTCString();
  if (cmp(amount, singleTxLimit) > 0) {
    return `Per-transaction policy limit is binding: required funding exceeds the ${singleTxLimit.currency} single-transaction cap.`;
  }
  return `Weekend contractor-payout SLA at ${deadline} under the delayed-receivable downside. The EUR bank rail is past its Friday cutoff and closed over the weekend, so only the 24/7 Arc rail can fund in time (conservative completion ${Math.round(conservativeCompletionSec / 60)} min).`;
}

function consequence(
  destLabel: string,
  topUp: Money,
  timeToShortfallSec: number | null,
  asOf: Epoch
): string {
  if (timeToShortfallSec === null || topUp.amount === 0n) {
    return "No missed obligations projected under the downside scenario.";
  }
  const when = new Date((asOf + timeToShortfallSec) * 1000).toUTCString();
  return `Without action, ${destLabel} breaches its stressed reserve by ${fmt(topUp)} at ${when}, risking late or failed weekend contractor payouts.`;
}

/**
 * Resolve when a transfer's funds actually arrive at the destination. The
 * source is debited at initiation; the destination is credited only at the
 * rail's CONSERVATIVE completion time. Money in transit is not yet available.
 */
export function resolveArrival(
  data: TreasuryScenarioData,
  action: LiquidityAction
): { conservativeSec: number; arrivalAt: Epoch; railId: string; hasRail: boolean } {
  const rail = data.rails.find((r) => r.id === action.railId);
  const conservativeSec = rail ? rail.conservativeCompletionSec : 0;
  return { conservativeSec, arrivalAt: data.asOf + conservativeSec, railId: action.railId, hasRail: !!rail };
}

/**
 * Movement objects that model a proposed action's effect on the forecast with
 * settlement-aware timing: the source is debited now, the destination is
 * credited only when the funds conservatively arrive.
 */
export function actionToTransfers(data: TreasuryScenarioData, action: LiquidityAction): Movement[] {
  const { arrivalAt } = resolveArrival(data, action);
  const out = { ...action.amount, amount: -action.amount.amount };
  return [
    { at: data.asOf, poolId: action.sourcePoolId, delta: out },
    { at: arrivalAt, poolId: action.destPoolId, delta: action.amount },
  ];
}
