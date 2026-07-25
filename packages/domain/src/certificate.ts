import { hashValue } from "./hash.js";
import { runForecast, seriesFor } from "./forecast.js";
import { actionToTransfers } from "./optimizer.js";
import type {
  CoverageByPool,
  LiquidityRecommendation,
  PolicyEvaluation,
  SettlementCoverageCertificate,
  TreasuryScenarioData,
} from "./entities.js";

export const CERT_SCHEMA_VERSION = "scc-1.0";

/**
 * Settlement Coverage Certificate — the signature product primitive. A
 * machine-verifiable record that a specific proposed action keeps every
 * mandatory obligation covered, with all binding hashes bound in. The
 * `commitment` is SHA-256 over the canonical JSON of every other field; only
 * that opaque commitment is published on Arc. Anyone holding the private
 * certificate can recompute the hash and prove it matches the on-chain
 * bytes32 without revealing balances, corridors, or payout schedules.
 */
export function buildCertificate(
  data: TreasuryScenarioData,
  rec: LiquidityRecommendation,
  policyEval: PolicyEvaluation,
  simulationHash: string
): SettlementCoverageCertificate {
  const transfers = actionToTransfers(data, rec.action);
  const baseRun = runForecast(data, { scenario: "base", horizonHours: 48, stepSeconds: 3600, extraTransfers: transfers });
  const downRun = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600, extraTransfers: transfers });
  const preRun = runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 });

  const preActionLiquidity: CoverageByPool[] = data.pools.map((p) => ({
    poolId: p.id,
    corridorId: p.corridorId,
    amount: seriesFor(preRun, p.id).minBalance,
  }));
  const postActionLiquidity: CoverageByPool[] = data.pools.map((p) => ({
    poolId: p.id,
    corridorId: p.corridorId,
    amount: seriesFor(downRun, p.id).minBalance,
  }));

  const destSeriesBase = seriesFor(baseRun, rec.action.destPoolId);
  const destSeriesDown = seriesFor(downRun, rec.action.destPoolId);

  const coveredObligations = data.obligations.filter((o) =>
    rec.coveredObligationIds.includes(o.id)
  );

  const validFrom = data.asOf;
  const validUntil = data.asOf + data.policy.thresholds.proposalTtlSeconds;

  const body: Omit<SettlementCoverageCertificate, "commitment"> = {
    certificateId: `scc-${rec.id}`,
    schemaVersion: CERT_SCHEMA_VERSION,
    asOf: data.asOf,
    dataFreshness: data.dataStatus,
    coveredObligationIds: rec.coveredObligationIds,
    settlementWindows: coveredObligations.map((o) => ({ obligationId: o.id, dueAt: o.dueAt })),
    preActionLiquidity,
    postActionLiquidity,
    baseCaseMinCoverage: destSeriesBase.minBalance,
    stressedMinCoverage: destSeriesDown.minBalance,
    latestSafeExecutionAt: rec.latestSafeExecutionAt,
    recommendedAmount: rec.authoritativeAmount,
    maxSafeAmount: rec.maxSafeAmount,
    bindingConstraints: [rec.bindingConstraint],
    policyVersion: policyEval.policyVersion,
    policyResultHash: policyEval.resultHash,
    inputSnapshotHash: rec.inputSnapshotHash,
    forecastHash: rec.forecastHash,
    routeHash: rec.routeHash,
    simulationHash,
    railAssumptions: data.rails.map(
      (r) => `${r.id}: ${r.finalityCondition}; conservative completion ${Math.round(r.conservativeCompletionSec / 60)}min; health=${r.health}`
    ),
    validFrom,
    validUntil,
  };

  const commitment = hashValue(body);
  return { ...body, commitment };
}

/** Recompute the commitment and compare. Optionally check the on-chain bytes32. */
export function verifyCertificate(
  cert: SettlementCoverageCertificate,
  onchainCommitment?: string
): { matchesSelf: boolean; matchesChain: boolean | null; recomputed: string } {
  const { commitment, ...body } = cert;
  const recomputed = hashValue(body);
  const matchesSelf = recomputed === commitment;
  const matchesChain =
    onchainCommitment === undefined
      ? null
      : onchainCommitment.toLowerCase() === commitment.toLowerCase();
  return { matchesSelf, matchesChain, recomputed };
}
