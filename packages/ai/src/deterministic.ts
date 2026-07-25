import type { ExplainContext } from "./context.js";
import { AI_DISCLAIMER, type Explanation, type ExplanationResult } from "./schema.js";

/**
 * Deterministic explanation. Always available, no API key required. Composed
 * directly from the validated context, so it never fabricates anything. This is
 * the P0 path; the live model (explain.ts) is an optional upgrade.
 */
export function deterministicExplanation(ctx: ExplainContext): ExplanationResult {
  const explanation: Explanation = {
    headline: `${ctx.destWallet} needs ${ctx.authoritativeAmount} to stay covered through the weekend under the ${ctx.scenario} scenario.`,
    outlook: `As of ${ctx.asOf}, the base case is covered, but the ${ctx.scenario} case drives the destination below its stressed reserve. The smallest safe rebalance restores coverage while keeping the source wallet above its own reserve.`,
    bindingConstraint: ctx.bindingConstraint,
    whatToDo: `Move ${ctx.authoritativeAmount} over the Arc rail before ${ctx.latestSafeExecutionAt}. The maximum safe amount is ${ctx.maxSafeAmount}; anything above that is blocked by policy.`,
    consequenceOfInaction: ctx.consequenceOfInaction,
    confidenceNote: `Data status: ${ctx.dataStatus}. Coverage checked under base and stressed scenarios (stressed minimum coverage ${ctx.stressedMinCoverage}). Policy approvable: ${ctx.policyApprovable}.`,
  };
  return { source: "deterministic", explanation, disclaimer: AI_DISCLAIMER };
}
