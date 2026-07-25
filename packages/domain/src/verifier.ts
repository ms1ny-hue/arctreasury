import { cmp, isNeg } from "./money.js";
import type { Money } from "./money.js";
import { hashValue } from "./hash.js";
import { runForecast, seriesFor } from "./forecast.js";
import { actionToTransfers, resolveArrival } from "./optimizer.js";
import type { LiquidityAction, TreasuryScenarioData } from "./entities.js";
import { fmt } from "./util.js";

/**
 * Independent verifier. Recalculates every safety constraint directly from the
 * raw scenario data with the proposed action applied. It does NOT trust the
 * optimizer's amount, hashes, or claims. A proposal may proceed ONLY if this
 * returns `passed: true`. This is the second, adversarial calculation that
 * turns a recommendation into something an approver can rely on.
 */
export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface VerificationResult {
  passed: boolean;
  checks: VerifyCheck[];
  verificationHash: string;
}

export function verifyAction(
  data: TreasuryScenarioData,
  action: LiquidityAction
): VerificationResult {
  const checks: VerifyCheck[] = [];
  const t = data.policy.thresholds;
  const amt = action.amount;

  const push = (name: string, ok: boolean, detail: string) =>
    checks.push({ name, ok, detail });

  // Non-negative, non-zero.
  push("amount_positive", amt.amount > 0n, `amount = ${fmt(amt)}`);

  // Policy hard limits (recomputed independently of the policy engine).
  push(
    "within_single_tx_limit",
    cmp(amt, t.maxSingleTransaction) <= 0,
    `${fmt(amt)} vs single-tx cap ${fmt(t.maxSingleTransaction)}`
  );
  push(
    "within_daily_limit",
    cmp(amt, t.maxDailyAggregate) <= 0,
    `${fmt(amt)} vs daily cap ${fmt(t.maxDailyAggregate)}`
  );

  // Rail max size.
  const route = data.routes.find(
    (r) => r.sourcePoolId === action.sourcePoolId && r.destPoolId === action.destPoolId
  );
  const rail = route ? data.rails.find((r) => r.id === route.railId) : undefined;
  push("route_exists", !!route && !!rail, route ? `route ${route.id} / rail ${route.railId}` : "no route");
  if (rail) {
    push(
      "within_rail_size",
      cmp(amt, rail.maxSize) <= 0 && cmp(amt, rail.minSize) >= 0,
      `${fmt(amt)} within [${fmt(rail.minSize)}, ${fmt(rail.maxSize)}]`
    );
    push(
      "rail_healthy",
      rail.health !== "down",
      `rail ${rail.id} health=${rail.health}`
    );
  }

  // Destination allowlist.
  const destPool = data.pools.find((p) => p.id === action.destPoolId);
  const destAddr = destPool?.walletAddress.toLowerCase() ?? "";
  const allow = t.approvedDestinations.map((a) => a.toLowerCase());
  push(
    "destination_allowlisted",
    allow.includes(destAddr),
    `dest ${destAddr} ${allow.includes(destAddr) ? "in" : "NOT in"} allowlist`
  );

  // Approved instrument.
  push(
    "instrument_allowlisted",
    !!rail && t.approvedInstruments.includes(rail.id),
    rail ? `rail ${rail.id}` : "no rail"
  );

  // Settlement timing: the destination is credited only when funds conservatively
  // arrive. Independently reconstruct that arrival and the no-action breach time,
  // and require the money to land BEFORE the destination first breaches — a
  // nominally sufficient amount that arrives too late is unsafe.
  const arrival = resolveArrival(data, action);
  const arrivalSec = arrival.arrivalAt - data.asOf;
  const noAction = seriesFor(
    runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 }),
    action.destPoolId
  );
  const breachSec = noAction.timeToShortfallSec;
  push(
    "arrival_before_deadline",
    breachSec === null ? true : arrivalSec <= breachSec,
    breachSec === null
      ? "no breach in horizon"
      : `funds arrive +${Math.round(arrivalSec / 60)}min vs breach +${Math.round(breachSec / 60)}min (rail ${arrival.railId})`
  );

  // Coverage: apply the TIMED transfer and re-run the downside forecast for BOTH pools.
  const transfers = actionToTransfers(data, action);
  const post = runForecast(data, {
    scenario: "downside",
    horizonHours: 48,
    stepSeconds: 3600,
    extraTransfers: transfers,
  });

  const destSeries = seriesFor(post, action.destPoolId);
  const srcSeries = seriesFor(post, action.sourcePoolId);

  const destPoolObj = data.pools.find((p) => p.id === action.destPoolId)!;
  const srcPoolObj = data.pools.find((p) => p.id === action.sourcePoolId)!;

  push(
    "dest_covered_under_downside",
    cmp(destSeries.minBalance, destPoolObj.stressedReserve) >= 0,
    `dest min ${fmt(destSeries.minBalance)} >= stressed reserve ${fmt(destPoolObj.stressedReserve)}`
  );
  push(
    "source_not_starved_under_downside",
    cmp(srcSeries.minBalance, srcPoolObj.stressedReserve) >= 0,
    `source min ${fmt(srcSeries.minBalance)} >= stressed reserve ${fmt(srcPoolObj.stressedReserve)}`
  );
  push(
    "no_negative_balances",
    !isNeg(destSeries.minBalance) && !isNeg(srcSeries.minBalance),
    `dest min ${fmt(destSeries.minBalance)}, source min ${fmt(srcSeries.minBalance)}`
  );

  // Every mandatory obligation on the destination is fully covered at its due time.
  for (const ob of data.obligations.filter((o) => o.poolId === action.destPoolId && o.mandatory)) {
    const pt = destSeries.points.find((p) => p.at >= ob.dueAt);
    const ok = pt ? !isNeg(pt.closingBalance) : true;
    push(
      `obligation_covered_${ob.id}`,
      ok,
      `${ob.id} due ${new Date(ob.dueAt * 1000).toUTCString()}: closing ${pt ? fmt(pt.closingBalance) : "n/a"}`
    );
  }

  const passed = checks.every((c) => c.ok);
  const verificationHash = hashValue({ action, checks: checks.map((c) => ({ n: c.name, ok: c.ok })) });
  return { passed, checks, verificationHash };
}
