import { describe, it, expect } from "vitest";
import { northstarScenario } from "../src/seed.js";
import { recommendRebalance } from "../src/optimizer.js";
import { verifyAction } from "../src/verifier.js";
import { runForecast, seriesFor } from "../src/forecast.js";
import { add, fromDecimalString } from "../src/money.js";
import type { LiquidityAction, TreasuryScenarioData } from "../src/entities.js";

describe("settlement-aware timing", () => {
  const data = northstarScenario();

  it("passes when funds arrive before the breach (fast 24/7 Arc rail)", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const v = verifyAction(data, rec.action);
    const arrival = v.checks.find((c) => c.name === "arrival_before_deadline");
    expect(arrival?.ok).toBe(true);
    expect(v.passed).toBe(true);
  });

  it("blocks a nominally-sufficient amount that arrives too late (slow bank rail)", () => {
    // Re-route the transfer over the 3-day bank rail: same amount, but it lands
    // long after the Friday/weekend breach — must be rejected.
    const slow: TreasuryScenarioData = {
      ...data,
      routes: data.routes.map((r) =>
        r.id === "route-us-eu" ? { ...r, railId: "rail-bank-eur" } : r
      ),
    };
    const action: LiquidityAction = {
      kind: "rebalance",
      sourcePoolId: "pool-us",
      destPoolId: "pool-eu",
      railId: "rail-bank-eur",
      amount: fromDecimalString("2010000"),
    };
    const v = verifyAction(slow, action);
    const arrival = v.checks.find((c) => c.name === "arrival_before_deadline");
    expect(arrival?.ok).toBe(false);
    expect(v.passed).toBe(false);
  });

  it("does not count in-transit funds early: destination credit lands after arrival, not at init", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    // Destination series with the timed transfer applied.
    const run = runForecast(data, {
      scenario: "downside",
      horizonHours: 48,
      stepSeconds: 3600,
      extraTransfers: [
        { at: data.asOf, poolId: "pool-us", delta: { ...rec.action.amount, amount: -rec.action.amount.amount } },
        { at: data.asOf + 3 * 86400, poolId: "pool-eu", delta: rec.action.amount }, // far-future credit
      ],
    });
    const eu = seriesFor(run, "pool-eu");
    // With the credit pushed 3 days out, the EU wallet still breaches within 48h.
    expect(eu.timeToShortfallSec).not.toBeNull();
  });

  it("conserves value: an internal move nets to zero across pools at horizon end", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const withMove = runForecast(data, {
      scenario: "downside", horizonHours: 48, stepSeconds: 3600,
      extraTransfers: [
        { at: data.asOf, poolId: "pool-us", delta: { ...rec.action.amount, amount: -rec.action.amount.amount } },
        { at: data.asOf + 300, poolId: "pool-eu", delta: rec.action.amount },
      ],
    });
    const noMove = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 });
    const endWith = add(seriesFor(withMove, "pool-us").points.at(-1)!.closingBalance, seriesFor(withMove, "pool-eu").points.at(-1)!.closingBalance);
    const endNo = add(seriesFor(noMove, "pool-us").points.at(-1)!.closingBalance, seriesFor(noMove, "pool-eu").points.at(-1)!.closingBalance);
    expect(endWith.amount).toBe(endNo.amount);
  });
});
