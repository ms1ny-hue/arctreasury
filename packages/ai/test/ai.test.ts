import { describe, it, expect } from "vitest";
import { northstarScenario, recommendRebalance, evaluatePolicy, buildCertificate, hashValue } from "@arctreasury/domain";
import { buildExplainContext, deterministicExplanation, explainRecommendation } from "../src/index.js";

const data = northstarScenario();
const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
const pol = evaluatePolicy(data, rec.action);
const cert = buildCertificate(data, rec, pol, hashValue({ s: 1 }));
const ctx = buildExplainContext(data, rec, pol, cert);

describe("AI explanation", () => {
  it("builds a context of validated, pre-formatted figures", () => {
    expect(ctx.authoritativeAmount).toBe("2,010,000 USDC");
    expect(ctx.policyApprovable).toBe(true);
    expect(ctx.coveredObligations.length).toBeGreaterThan(0);
  });

  it("deterministic explanation references the authoritative amount and never fabricates", () => {
    const r = deterministicExplanation(ctx);
    expect(r.source).toBe("deterministic");
    expect(r.explanation.whatToDo).toContain("2,010,000 USDC");
    expect(r.disclaimer).toMatch(/cannot alter/i);
  });

  it("falls back to deterministic when no API key is configured", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    const saved2 = process.env.ARCTREASURY_AI_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ARCTREASURY_AI_KEY;
    try {
      const r = await explainRecommendation(ctx);
      expect(r.source).toBe("deterministic");
      expect(r.explanation.headline).toContain("2,010,000 USDC");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
      if (saved2 !== undefined) process.env.ARCTREASURY_AI_KEY = saved2;
    }
  });
});
