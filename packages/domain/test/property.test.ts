import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { northstarScenario } from "../src/seed.js";
import { verifyAction } from "../src/verifier.js";
import { recommendRebalance } from "../src/optimizer.js";
import { money, cmp } from "../src/money.js";
import type { LiquidityAction } from "../src/entities.js";

const data = northstarScenario();
const t = data.policy.thresholds;

describe("safety invariants (property-based)", () => {
  it("a verified action never exceeds the single-transaction cap", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000_000_000n }), (atoms) => {
        const action: LiquidityAction = {
          kind: "rebalance",
          sourcePoolId: "pool-us",
          destPoolId: "pool-eu",
          railId: "rail-arc-internal",
          amount: money(atoms),
        };
        const v = verifyAction(data, action);
        if (v.passed) {
          // if the independent verifier passed, the amount must be within the cap
          return cmp(action.amount, t.maxSingleTransaction) <= 0;
        }
        return true;
      }),
      { numRuns: 200 }
    );
  });

  it("the recommended amount never exceeds the computed max-safe amount", () => {
    fc.assert(
      fc.property(fc.constant(0), () => {
        const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
        return cmp(rec.authoritativeAmount, rec.maxSafeAmount) <= 0;
      })
    );
  });

  it("any amount that leaves the destination below its stressed reserve fails verification", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 1_799_999_999_999n }), (atoms) => {
        // below the required 1.8M top-up => dest stays under stressed reserve
        const action: LiquidityAction = {
          kind: "rebalance",
          sourcePoolId: "pool-us",
          destPoolId: "pool-eu",
          railId: "rail-arc-internal",
          amount: money(atoms),
        };
        const v = verifyAction(data, action);
        const coverage = v.checks.find((c) => c.name === "dest_covered_under_downside");
        return coverage?.ok === false;
      }),
      { numRuns: 100 }
    );
  });
});
