import {
  northstarScenario,
  runForecast,
  seriesFor,
  recommendRebalance,
  verifyAction,
  evaluatePolicy,
  buildCertificate,
  resolveArrival,
  hashValue,
  canonicalize,
  sha256Hex,
  fmt,
  humanUtc,
  type ScenarioKind,
  type TreasuryScenarioData,
} from "@arctreasury/domain";
import { ARC_TESTNET } from "@arctreasury/config";
import deployment from "../../../packages/contracts/deployments/arc-testnet.json";

export const DEPLOYMENT = deployment;
const SIM = "0xsim-pipeline";

export type ScenarioChoice = "downside" | "severe" | "base";

/**
 * Run the full deterministic decision loop for a chosen stress scenario and
 * build a canonical, tamper-evident evidence bundle. The scenario is the only
 * knob a judge changes; every number below is computed, not stored.
 */
export interface PipelineOpts {
  data?: TreasuryScenarioData;
  sourcePoolId?: string;
  destPoolId?: string;
  dataSource?: string; // provenance label for external datasets
}

export function computePipeline(scenario: ScenarioChoice = "downside", opts: PipelineOpts = {}) {
  const data = opts.data ?? northstarScenario();
  const sourcePoolId = opts.sourcePoolId ?? data.pools[data.pools.length - 1]?.id ?? "pool-us";
  const destPoolId = opts.destPoolId ?? data.pools[0]?.id ?? "pool-eu";
  const dataSource = opts.dataSource ?? (opts.data ? "external (API-supplied)" : "northstar fixture");

  const fc = runForecast(data, { scenario: scenario as ScenarioKind, horizonHours: 48, stepSeconds: 3600 });
  const eu = seriesFor(fc, destPoolId);

  const rec = recommendRebalance(data, { sourcePoolId, destPoolId });
  const arrival = resolveArrival(data, rec.action);
  const verification = verifyAction(data, rec.action);
  const policyEval = evaluatePolicy(data, rec.action);
  const cert = buildCertificate(data, rec, policyEval, SIM);

  const covered = data.obligations.filter((o) => rec.coveredObligationIds.includes(o.id));

  // Canonical evidence bundle (commitment excluded, then hashed).
  const bundleBody = {
    schema: "arctreasury-evidence/1.0",
    scenario,
    asOf: data.asOf,
    asOfHuman: humanUtc(data.asOf),
    dataStatus: data.dataStatus,
    dataSource,
    account: data.accountId,
    inputSnapshotHash: rec.inputSnapshotHash,
    policyHash: policyEval.resultHash,
    forecastHash: rec.forecastHash,
    verificationHash: verification.verificationHash,
    attestationCommitment: cert.commitment,
    coveredObligations: covered.map((o) => ({ id: o.id, amount: fmt(o.amount), dueAt: humanUtc(o.dueAt) })),
    rail: rec.action.railId,
    conservativeArrivalAt: humanUtc(arrival.arrivalAt),
    requiredAmount: fmt(rec.authoritativeAmount),
    maxSafeAmount: fmt(rec.maxSafeAmount),
    bindingConstraint: rec.bindingConstraint,
    sizingMethod: "analytically minimal · single route",
    checks: verification.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
    policyApprovable: policyEval.approvable,
    proposalState: verification.passed && policyEval.approvable ? "awaiting_approval" : "blocked",
    contract: deployment.address,
    chainId: ARC_TESTNET.chainId,
    tx: null as string | null,
  };
  const bundleCommitment = hashValue(bundleBody);
  const evidence = { ...bundleBody, bundleCommitment };

  return {
    scenario,
    asOf: humanUtc(data.asOf),
    account: data.accountId,
    dataStatus: data.dataStatus,
    dataSource,
    forecast: {
      baseVsScenario: scenario,
      minBalance: fmt(eu.minBalance),
      shortfallAt: eu.timeToShortfallSec === null ? null : humanUtc(data.asOf + eu.timeToShortfallSec),
      requiredTopUp: fmt(eu.requiredTopUp),
      points: eu.points.filter((_, i) => i % 3 === 0).map((p) => ({
        at: humanUtc(p.at).slice(0, 22),
        closing: fmt(p.closingBalance),
        reserve: fmt(p.requiredReserve),
        short: p.coverageShortfall.amount > 0n,
      })),
    },
    recommendation: {
      amount: fmt(rec.authoritativeAmount),
      maxSafe: fmt(rec.maxSafeAmount),
      latestSafe: humanUtc(rec.latestSafeExecutionAt),
      arrivalAt: humanUtc(arrival.arrivalAt),
      binding: rec.bindingConstraint,
      consequence: rec.consequenceOfInaction,
      rail: rec.action.railId,
      sizingMethod: "analytically minimal · single route",
    },
    verification: { passed: verification.passed, checks: verification.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })) },
    policy: { approvable: policyEval.approvable, checks: policyEval.checks.map((c) => ({ ruleId: c.ruleId, status: c.status, observed: c.observedValue, threshold: c.threshold })) },
    certificate: { id: cert.certificateId, commitment: cert.commitment, baseCoverage: fmt(cert.baseCaseMinCoverage), stressedCoverage: fmt(cert.stressedMinCoverage), validUntil: humanUtc(cert.validUntil) },
    evidence,
  };
}

/** Recompute an evidence bundle's commitment from its body (integrity check). */
export function recomputeEvidenceCommitment(bundle: Record<string, unknown>): { recomputed: string; matches: boolean } {
  const { bundleCommitment, ...body } = bundle as { bundleCommitment?: string } & Record<string, unknown>;
  const recomputed = sha256Hex(canonicalize(body));
  return { recomputed, matches: typeof bundleCommitment === "string" && recomputed.toLowerCase() === bundleCommitment.toLowerCase() };
}
