import { sub, clampNonNeg, fromDecimalString, toDecimalString, type Money } from "./money.js";
import { fmt } from "./util.js";

const dec = (m: Money): string => toDecimalString(m, true);
import { runForecast, seriesFor } from "./forecast.js";
import type { LiquidityRecommendation, TreasuryScenarioData } from "./entities.js";

/**
 * Shadow mode. Compares ArcTreasury's recommended dynamic funding against a
 * configurable STATIC-BUFFER baseline WITHOUT moving money. Every number is
 * computed from the dataset with the formula and assumptions shown. We never
 * fabricate savings, and we never annualize unless explicitly asked.
 */
export interface ShadowMetric {
  name: string;
  arctreasury: string;
  baseline: string;
  unit: string;
  formula: string;
  assumptions: string;
}
export interface ShadowResult {
  measurementPeriodHours: number;
  staticBuffer: Money;
  recommendedAmount: Money;
  capitalReleased: Money;
  reductionPct: string;
  avoidedShortfalls: number;
  metrics: ShadowMetric[];
  disclaimer: string;
}

export interface ShadowOptions {
  /** Static buffer the baseline keeps idle in the destination wallet. */
  staticBuffer?: Money;
  horizonHours?: number;
  /** Hours the dynamic top-up sits idle before its obligation consumes it. */
  dynamicIdleHours?: number;
}

const atomicHoursToUsdc = (atoms: bigint): string =>
  (atoms / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function runShadowComparison(
  data: TreasuryScenarioData,
  rec: LiquidityRecommendation,
  opts: ShadowOptions = {}
): ShadowResult {
  const horizon = opts.horizonHours ?? 48;
  const staticBuffer = opts.staticBuffer ?? fromDecimalString("3000000");
  const A = rec.authoritativeAmount;
  const idleHours = opts.dynamicIdleHours ?? 23; // conservative: acted Friday, consumed Sat 12:00

  // Avoided shortfalls vs DOING NOTHING (no action) under the downside scenario.
  const noAction = runForecast(data, { scenario: "downside", horizonHours: horizon, stepSeconds: 3600 });
  const avoidedShortfalls = data.pools.filter((p) => {
    const s = seriesFor(noAction, p.id);
    return s.timeToShortfallSec !== null;
  }).length;

  const capitalReleased = clampNonNeg(sub(staticBuffer, A));
  const reductionPct =
    staticBuffer.amount === 0n
      ? "0.0"
      : ((Number(capitalReleased.amount) / Number(staticBuffer.amount)) * 100).toFixed(1);

  const baselineIdle = staticBuffer.amount * BigInt(horizon);
  const arcIdle = A.amount * BigInt(idleHours);

  const metrics: ShadowMetric[] = [
    {
      name: "Peak prefunding",
      arctreasury: dec(A),
      baseline: dec(staticBuffer),
      unit: "USDC",
      formula: "max prefunded balance held over the measurement period",
      assumptions: "Baseline keeps a fixed idle buffer; ArcTreasury moves only the verified minimum top-up.",
    },
    {
      name: "Average prefunding",
      arctreasury: dec(A),
      baseline: dec(staticBuffer),
      unit: "USDC",
      formula: "time-weighted mean prefunded balance",
      assumptions: "Single top-up held flat until consumed; baseline held flat across horizon.",
    },
    {
      name: "Dollar-hours idle",
      arctreasury: atomicHoursToUsdc(arcIdle),
      baseline: atomicHoursToUsdc(baselineIdle),
      unit: "USDC-hours",
      formula: `amount x hours idle  (Arc: ${A.currency} x ${idleHours}h; baseline: buffer x ${horizon}h)`,
      assumptions: `ArcTreasury top-up idle ${idleHours}h before the Sat payout; baseline idle full ${horizon}h.`,
    },
    {
      name: "Obligations covered on time",
      arctreasury: "all mandatory (verified)",
      baseline: "all mandatory (over-funded)",
      unit: "count",
      formula: "obligations with closing balance >= 0 at due time / total mandatory",
      assumptions: "Both cover; the difference is capital efficiency, not coverage.",
    },
    {
      name: "Capital released",
      arctreasury: dec(capitalReleased),
      baseline: "0",
      unit: "USDC",
      formula: "static buffer - verified minimum top-up",
      assumptions: `Static buffer = ${fmt(staticBuffer)} (configurable).`,
    },
    {
      name: "Forecast error (MAE / bias)",
      arctreasury: "n/a",
      baseline: "n/a",
      unit: "USDC",
      formula: "mean(|forecast - actual|); requires historical actuals",
      assumptions: "Demo dataset has no realized actuals, so forecast error is not claimed.",
    },
  ];

  return {
    measurementPeriodHours: horizon,
    staticBuffer,
    recommendedAmount: A,
    capitalReleased,
    reductionPct,
    avoidedShortfalls,
    metrics,
    disclaimer:
      "SIMULATED demo dataset. Figures are counterfactual, computed from seed data with the formulas shown. Not annualized. Not a promise of production savings.",
  };
}
