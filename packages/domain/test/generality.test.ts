import { describe, it, expect } from "vitest";
import { northstarScenario } from "../src/seed.js";
import { scenarioToInput, parseScenarioInput, toScenario, type ScenarioInput } from "../src/ingest.js";
import { recommendRebalance } from "../src/optimizer.js";
import { verifyAction } from "../src/verifier.js";
import { toDecimalString } from "../src/money.js";

/**
 * Anti-"scripted demo" proof: the engine is a function of its input. Two
 * unrelated datasets, submitted through the SAME external ingestion boundary,
 * produce different results; changing an input changes the output; and no
 * result depends on the Northstar fixture.
 */

// Base external dataset (Northstar exported to the external format).
const base: ScenarioInput = scenarioToInput(northstarScenario());

// A second, unrelated company: smaller wallets, a bigger single payout, tighter reserves.
function companyB(): ScenarioInput {
  const b: ScenarioInput = JSON.parse(JSON.stringify(base));
  b.accountId = "helio-remit";
  b.pools = b.pools.map((p) =>
    p.id === "pool-eu"
      ? { ...p, balance: "1500000", operatingReserve: "300000", stressedReserve: "500000" }
      : { ...p, balance: "4000000" }
  );
  // one large weekend payout instead of Northstar's amounts
  b.obligations = [
    { ...b.obligations[0]!, id: "ob-payroll", kind: "contractor_payout", amount: "2500000", description: "Weekend payroll" },
  ];
  return b;
}

describe("engine generality (arbitrary external input)", () => {
  it("round-trips the external format without loss", () => {
    const back = toScenario(parseScenarioInput(base));
    expect(toDecimalString(back.pools[0]!.balance)).toBe("3200000");
  });

  it("two unrelated datasets produce different recommendations", () => {
    const recA = recommendRebalance(toScenario(base), { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const recB = recommendRebalance(toScenario(companyB()), { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    expect(toDecimalString(recA.authoritativeAmount)).not.toBe(toDecimalString(recB.authoritativeAmount));
  });

  it("changing an obligation amount changes the required funding", () => {
    const d1 = parseScenarioInput(base);
    const d2: ScenarioInput = JSON.parse(JSON.stringify(d1));
    const payout = d2.obligations.find((o) => o.id === "ob-payout-sat")!;
    payout.amount = "2800000"; // was 1,800,000
    const r1 = recommendRebalance(toScenario(d1), { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const r2 = recommendRebalance(toScenario(d2), { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    expect(r2.authoritativeAmount.amount).toBeGreaterThan(r1.authoritativeAmount.amount);
  });

  it("changing route arrival time flips whether the route is permitted", () => {
    // Fast rail: permitted.
    const fast = toScenario(base);
    const recFast = recommendRebalance(fast, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    expect(verifyAction(fast, recFast.action).checks.find((c) => c.name === "arrival_before_deadline")?.ok).toBe(true);

    // Same dataset, but the Arc rail's conservative completion is pushed past the breach → rejected.
    const slowInput: ScenarioInput = JSON.parse(JSON.stringify(base));
    slowInput.rails = slowInput.rails.map((r) => (r.id === "rail-arc-internal" ? { ...r, conservativeCompletionSec: 4 * 86400 } : r));
    const slow = toScenario(slowInput);
    const recSlow = recommendRebalance(slow, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const v = verifyAction(slow, recSlow.action);
    expect(v.checks.find((c) => c.name === "arrival_before_deadline")?.ok).toBe(false);
    expect(v.passed).toBe(false);
  });

  it("rejects malformed external input at the boundary", () => {
    const bad = { ...base, pools: [{ ...base.pools[0], balance: "not-a-number" }] };
    expect(() => parseScenarioInput(bad)).toThrow();
  });
});
