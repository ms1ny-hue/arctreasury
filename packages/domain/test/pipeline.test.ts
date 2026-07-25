import { describe, it, expect } from "vitest";
import { northstarScenario, ASOF, ADDR, HOUR } from "../src/seed.js";
import { recommendRebalance } from "../src/optimizer.js";
import { verifyAction } from "../src/verifier.js";
import { evaluatePolicy } from "../src/policy.js";
import { buildCertificate, verifyCertificate } from "../src/certificate.js";
import {
  createProposal,
  approveProposal,
  guardExecution,
  beginExecution,
  settleExecution,
  verifyAuditChain,
  type BoundHashes,
} from "../src/proposal.js";
import { toDecimalString, fromDecimalString } from "../src/money.js";
import type { LiquidityAction } from "../src/entities.js";

const SIM_HASH = "0xsim";

describe("recommendation + verification", () => {
  const data = northstarScenario();

  it("recommends the smallest safe rebalance US -> EU of 2,010,000", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    expect(toDecimalString(rec.authoritativeAmount)).toBe("2010000");
    expect(rec.optimizerStatus).toBe("optimal");
    expect(rec.action.railId).toBe("rail-arc-internal");
    expect(rec.maxSafeAmount.amount).toBeGreaterThanOrEqual(rec.authoritativeAmount.amount);
  });

  it("independently verifies the safe action passes", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const v = verifyAction(data, rec.action);
    expect(v.passed).toBe(true);
  });

  it("blocks an unsafe larger release (exceeds single-tx cap)", () => {
    const unsafe: LiquidityAction = {
      kind: "release",
      sourcePoolId: "pool-us",
      destPoolId: "pool-eu",
      railId: "rail-arc-internal",
      amount: fromDecimalString("3500000"),
    };
    const v = verifyAction(data, unsafe);
    expect(v.passed).toBe(false);
    expect(v.checks.find((c) => c.name === "within_single_tx_limit")?.ok).toBe(false);
  });

  it("blocks an unapproved destination at the policy layer", () => {
    const data2 = northstarScenario();
    // point EU pool wallet at a non-allowlisted address
    const badData = {
      ...data2,
      pools: data2.pools.map((p) =>
        p.id === "pool-eu" ? { ...p, walletAddress: ADDR.unapproved } : p
      ),
    };
    const rec = recommendRebalance(badData, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const evalr = evaluatePolicy(badData, rec.action);
    expect(evalr.approvable).toBe(false);
    expect(evalr.checks.find((c) => c.ruleId === "approved_destination")?.status).toBe("fail");
  });
});

describe("certificate", () => {
  const data = northstarScenario();
  it("builds and self-verifies the commitment; tamper breaks it", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const evalr = evaluatePolicy(data, rec.action);
    const cert = buildCertificate(data, rec, evalr, SIM_HASH);
    const ok = verifyCertificate(cert);
    expect(ok.matchesSelf).toBe(true);

    const tampered = { ...cert, recommendedAmount: fromDecimalString("9999999") };
    expect(verifyCertificate(tampered).matchesSelf).toBe(false);
  });

  it("matches an on-chain commitment when equal", () => {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const evalr = evaluatePolicy(data, rec.action);
    const cert = buildCertificate(data, rec, evalr, SIM_HASH);
    expect(verifyCertificate(cert, cert.commitment).matchesChain).toBe(true);
    expect(verifyCertificate(cert, "0xdeadbeef").matchesChain).toBe(false);
  });
});

describe("proposal lifecycle + audit chain", () => {
  const data = northstarScenario();

  function buildSafeProposal() {
    const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
    const evalr = evaluatePolicy(data, rec.action);
    const v = verifyAction(data, rec.action);
    const p = createProposal(rec, evalr, v, SIM_HASH, data.asOf, data.policy.thresholds.proposalTtlSeconds);
    return { rec, evalr, v, p };
  }

  it("moves a safe proposal to awaiting_approval, then approved, then settled", () => {
    const { p } = buildSafeProposal();
    expect(p.state).toBe("awaiting_approval");
    const hashes: BoundHashes = p.boundHashes;
    const approved = approveProposal(p, ADDR.poolUs, data.asOf + 60, hashes, "0xsig");
    expect(approved.state).toBe("approved");
    const guard = guardExecution(approved, data.asOf + 120, hashes);
    expect(guard.ok).toBe(true);
    const exec = beginExecution(approved, data.asOf + 120);
    const settled = settleExecution(exec, data.asOf + 130, "0xabc", 123, "https://testnet.arcscan.app/tx/0xabc");
    expect(settled.state).toBe("settled");
    expect(settled.execution.txHash).toBe("0xabc");
    expect(verifyAuditChain(settled.audit)).toBe(true);
  });

  it("keeps an unsafe proposal out of awaiting_approval (blocked)", () => {
    const unsafe: LiquidityAction = {
      kind: "release",
      sourcePoolId: "pool-us",
      destPoolId: "pool-eu",
      railId: "rail-arc-internal",
      amount: fromDecimalString("3500000"),
    };
    const rec = { ...recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" }), action: unsafe, authoritativeAmount: unsafe.amount };
    const evalr = evaluatePolicy(data, unsafe);
    const v = verifyAction(data, unsafe);
    const p = createProposal(rec, evalr, v, SIM_HASH, data.asOf, 7200);
    expect(p.state).toBe("evaluated");
    expect(() => approveProposal(p, ADDR.poolUs, data.asOf + 60, p.boundHashes)).toThrow();
  });

  it("invalidates a stale approval when a bound hash changes", () => {
    const { p } = buildSafeProposal();
    const changed: BoundHashes = { ...p.boundHashes, forecastHash: "0xchanged" };
    const result = approveProposal(p, ADDR.poolUs, data.asOf + 60, changed);
    expect(result.state).toBe("invalidated");
  });

  it("guard blocks execution when inputs changed after approval", () => {
    const { p } = buildSafeProposal();
    const approved = approveProposal(p, ADDR.poolUs, data.asOf + 60, p.boundHashes);
    const stale: BoundHashes = { ...p.boundHashes, simulationHash: "0xnew" };
    const guard = guardExecution(approved, data.asOf + 120, stale);
    expect(guard.ok).toBe(false);
  });
});
