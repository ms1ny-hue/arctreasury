import { describe, it, expect } from "vitest";
import { northstarScenario } from "../src/seed.js";
import { runForecast, seriesFor } from "../src/forecast.js";
import { toDecimalString } from "../src/money.js";

describe("deterministic forecast engine", () => {
  const data = northstarScenario();

  it("keeps EU pool covered under the base scenario", () => {
    const run = runForecast(data, { scenario: "base", horizonHours: 48, stepSeconds: 3600 });
    const eu = seriesFor(run, "pool-eu");
    expect(eu.timeToShortfallSec).toBeNull();
    expect(toDecimalString(eu.requiredTopUp)).toBe("0");
  });

  it("detects the weekend shortfall under downside and sizes the top-up at 1,800,000", () => {
    const run = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 });
    const eu = seriesFor(run, "pool-eu");
    expect(eu.timeToShortfallSec).not.toBeNull();
    // downside applies +5% outflow shock: merchant 2.52M + payout 1.89M vs opening 3.2M
    // => min -1.21M; floor stressed 800k => required top-up 2,010,000
    expect(toDecimalString(eu.requiredTopUp)).toBe("2010000");
  });

  it("shows the US pool has releasable excess under downside", () => {
    const run = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 });
    const us = seriesFor(run, "pool-us");
    expect(toDecimalString(us.requiredTopUp)).toBe("0");
    expect(us.maxSafeRelease.amount).toBeGreaterThan(0n);
  });

  it("is deterministic: identical inputs => identical forecast hash", () => {
    const a = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 });
    const b = runForecast(northstarScenario(), { scenario: "downside", horizonHours: 48, stepSeconds: 3600 });
    expect(a.forecastHash).toBe(b.forecastHash);
  });

  it("produces a 14-day daily planning horizon", () => {
    const run = runForecast(data, { scenario: "base", horizonHours: 336, stepSeconds: 86400 });
    const eu = seriesFor(run, "pool-eu");
    expect(eu.points.length).toBeGreaterThan(13);
  });
});
