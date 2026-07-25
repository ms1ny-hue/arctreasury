import {
  add,
  sub,
  clampNonNeg,
  max as mmax,
  min as mmin,
  scale,
  zero,
  cmp,
} from "./money.js";
import type { Money } from "./money.js";
import { hashValue } from "./hash.js";
import type {
  CashFlowEvent,
  Epoch,
  ForecastPoint,
  ForecastRun,
  ForecastSeries,
  LiquidityPool,
  ScenarioKind,
  SettlementObligation,
  TreasuryScenarioData,
} from "./entities.js";
import { DAY } from "./seed.js";

/**
 * Deterministic forecasting engine.
 *
 * Same inputs + same scenario => byte-identical output (and identical hash).
 * No randomness, no wall clock. Scenario shocks are explicit transforms:
 *   base     — all cash flows at their stated value time; floor = operating reserve.
 *   downside — `at_risk` inflows delayed beyond horizon, `expected` inflows
 *              haircut 10%, outflows +5%; floor = stressed reserve.
 *   severe   — `at_risk` AND `expected` inflows delayed beyond horizon,
 *              outflows +15%; floor = stressed reserve.
 */
interface ScenarioShock {
  delayAtRisk: boolean;
  delayExpected: boolean;
  inflowExpectedFactor: [bigint, bigint]; // num/den
  outflowFactor: [bigint, bigint];
  useStressedReserve: boolean;
}

const SHOCKS: Record<ScenarioKind, ScenarioShock> = {
  base: {
    delayAtRisk: false,
    delayExpected: false,
    inflowExpectedFactor: [1n, 1n],
    outflowFactor: [1n, 1n],
    useStressedReserve: false,
  },
  downside: {
    delayAtRisk: true,
    delayExpected: false,
    inflowExpectedFactor: [90n, 100n],
    outflowFactor: [105n, 100n],
    useStressedReserve: true,
  },
  severe: {
    delayAtRisk: true,
    delayExpected: true,
    inflowExpectedFactor: [50n, 100n],
    outflowFactor: [115n, 100n],
    useStressedReserve: true,
  },
};

const FAR_FUTURE = 3650 * DAY;

interface Movement {
  at: Epoch;
  poolId: string;
  delta: Money; // signed: + inflow, - outflow
}

function shockedMovements(
  data: TreasuryScenarioData,
  scenario: ScenarioKind,
  extraTransfers: Movement[] = []
): Movement[] {
  const shock = SHOCKS[scenario];
  const moves: Movement[] = [];

  for (const cf of data.cashFlows) {
    let at = cf.valueAt;
    let amount = cf.amount;
    if (cf.direction === "inflow") {
      if (cf.certainty === "at_risk" && shock.delayAtRisk) at += FAR_FUTURE;
      if (cf.certainty === "expected") {
        if (shock.delayExpected) at += FAR_FUTURE;
        else amount = scale(amount, shock.inflowExpectedFactor[0], shock.inflowExpectedFactor[1]);
      }
      moves.push({ at, poolId: cf.poolId, delta: amount });
    } else {
      amount = scale(amount, shock.outflowFactor[0], shock.outflowFactor[1]);
      moves.push({ at, poolId: cf.poolId, delta: { ...amount, amount: -amount.amount } });
    }
  }

  for (const ob of data.obligations) {
    const amount = scale(ob.amount, shock.outflowFactor[0], shock.outflowFactor[1]);
    moves.push({ at: ob.dueAt, poolId: ob.poolId, delta: { ...amount, amount: -amount.amount } });
  }

  moves.push(...extraTransfers);
  return moves;
}

function reserveFloor(pool: LiquidityPool, scenario: ScenarioKind): Money {
  return SHOCKS[scenario].useStressedReserve ? pool.stressedReserve : pool.operatingReserve;
}

function buildSeries(
  pool: LiquidityPool,
  moves: Movement[],
  scenario: ScenarioKind,
  asOf: Epoch,
  horizonHours: number,
  stepSeconds: number
): ForecastSeries {
  const floor = reserveFloor(pool, scenario);
  const poolMoves = moves.filter((m) => m.poolId === pool.id).sort((a, b) => a.at - b.at);
  const points: ForecastPoint[] = [];

  let running = pool.balance;
  let minBalance = pool.balance;
  let minBalanceAt = asOf;
  let timeToShortfall: number | null = null;

  const steps = Math.ceil((horizonHours * 3600) / stepSeconds);
  let cursor = 0;
  for (let i = 0; i <= steps; i++) {
    const t = asOf + i * stepSeconds;
    const opening = running;
    let inflow = zero(pool.balance.currency, pool.balance.decimals);
    let outflow = zero(pool.balance.currency, pool.balance.decimals);
    while (cursor < poolMoves.length && poolMoves[cursor]!.at <= t) {
      const d = poolMoves[cursor]!.delta;
      if (d.amount >= 0n) inflow = add(inflow, d);
      else outflow = add(outflow, { ...d, amount: -d.amount });
      running = add(running, d);
      cursor++;
    }
    const closing = running;
    const shortfall = clampNonNeg(sub(floor, closing));
    points.push({
      at: t,
      poolId: pool.id,
      openingBalance: opening,
      inflow,
      outflow,
      closingBalance: closing,
      requiredReserve: floor,
      coverageShortfall: shortfall,
    });
    if (cmp(closing, minBalance) < 0) {
      minBalance = closing;
      minBalanceAt = t;
    }
    if (timeToShortfall === null && cmp(closing, floor) < 0) {
      timeToShortfall = t - asOf;
    }
  }

  const requiredTopUp = clampNonNeg(sub(floor, minBalance));
  const maxSafeRelease = clampNonNeg(sub(minBalance, floor));

  return {
    poolId: pool.id,
    scenario,
    points,
    minBalance,
    minBalanceAt,
    timeToShortfallSec: timeToShortfall,
    requiredTopUp,
    maxSafeRelease,
  };
}

export interface ForecastOptions {
  scenario: ScenarioKind;
  horizonHours: number; // 48 operational, 336 (14d) planning
  stepSeconds: number; // 3600 hourly, 86400 daily
  extraTransfers?: Movement[]; // model a proposed rebalance's effect
}

export function runForecast(
  data: TreasuryScenarioData,
  opts: ForecastOptions
): ForecastRun {
  const moves = shockedMovements(data, opts.scenario, opts.extraTransfers ?? []);
  const series = data.pools.map((p) =>
    buildSeries(p, moves, opts.scenario, data.asOf, opts.horizonHours, opts.stepSeconds)
  );
  const inputSnapshotHash = hashValue({
    accountId: data.accountId,
    asOf: data.asOf,
    pools: data.pools,
    obligations: data.obligations,
    cashFlows: data.cashFlows,
    policyVersion: data.policy.version,
  });
  const forecastHash = hashValue({
    inputSnapshotHash,
    scenario: opts.scenario,
    horizonHours: opts.horizonHours,
    stepSeconds: opts.stepSeconds,
    extra: opts.extraTransfers ?? [],
    series: series.map((s) => ({
      poolId: s.poolId,
      minBalance: s.minBalance,
      minBalanceAt: s.minBalanceAt,
      requiredTopUp: s.requiredTopUp,
      maxSafeRelease: s.maxSafeRelease,
      timeToShortfallSec: s.timeToShortfallSec,
    })),
  });

  return {
    id: `fc-${opts.scenario}-${opts.horizonHours}h-${data.asOf}`,
    asOf: data.asOf,
    horizonHours: opts.horizonHours,
    stepSeconds: opts.stepSeconds,
    scenario: opts.scenario,
    series,
    inputSnapshotHash,
    forecastHash,
  };
}

export type { Movement };
export function seriesFor(run: ForecastRun, poolId: string): ForecastSeries {
  const s = run.series.find((x) => x.poolId === poolId);
  if (!s) throw new Error(`No forecast series for pool ${poolId}`);
  return s;
}
