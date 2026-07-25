import { describe, it, expect } from "vitest";
import { northstarScenario } from "../src/seed.js";
import { recommendRebalance } from "../src/optimizer.js";
import { runShadowComparison } from "../src/shadow.js";
import { toDecimalString, fromDecimalString } from "../src/money.js";

describe("shadow-mode ROI", () => {
  const data = northstarScenario();
  const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });

  it("computes capital released vs a static 3,000,000 buffer", () => {
    const s = runShadowComparison(data, rec, { staticBuffer: fromDecimalString("3000000") });
    expect(toDecimalString(s.capitalReleased)).toBe("990000"); // 3.0M - 2.01M
    expect(s.reductionPct).toBe("33.0");
  });

  it("counts avoided shortfalls vs doing nothing", () => {
    const s = runShadowComparison(data, rec);
    expect(s.avoidedShortfalls).toBe(1); // EU pool would breach
  });

  it("does not fabricate forecast error without actuals", () => {
    const s = runShadowComparison(data, rec);
    const fe = s.metrics.find((m) => m.name.startsWith("Forecast error"));
    expect(fe?.arctreasury).toBe("n/a");
  });
});
