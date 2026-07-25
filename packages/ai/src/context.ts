import { fmt, humanUtc, type LiquidityRecommendation, type PolicyEvaluation, type SettlementCoverageCertificate, type TreasuryScenarioData } from "@arctreasury/domain";

/**
 * Build the ONLY facts the model is given: validated, pre-formatted figures.
 * The model receives no raw balances to recompute and no tools to act with.
 */
export interface ExplainContext {
  asOf: string;
  dataStatus: string;
  scenario: string;
  destWallet: string;
  authoritativeAmount: string;
  maxSafeAmount: string;
  latestSafeExecutionAt: string;
  bindingConstraint: string;
  consequenceOfInaction: string;
  coveredObligations: string[];
  baseCaseMinCoverage: string;
  stressedMinCoverage: string;
  policyApprovable: boolean;
  policyChecks: { rule: string; status: string }[];
}

export function buildExplainContext(
  data: TreasuryScenarioData,
  rec: LiquidityRecommendation,
  policyEval: PolicyEvaluation,
  cert: SettlementCoverageCertificate
): ExplainContext {
  const dest = data.pools.find((p) => p.id === rec.action.destPoolId);
  return {
    asOf: humanUtc(data.asOf),
    dataStatus: data.dataStatus,
    scenario: "downside (delayed receivable, +5% outflows)",
    destWallet: dest?.label ?? rec.action.destPoolId,
    authoritativeAmount: fmt(rec.authoritativeAmount),
    maxSafeAmount: fmt(rec.maxSafeAmount),
    latestSafeExecutionAt: humanUtc(rec.latestSafeExecutionAt),
    bindingConstraint: rec.bindingConstraint,
    consequenceOfInaction: rec.consequenceOfInaction,
    coveredObligations: rec.coveredObligationIds,
    baseCaseMinCoverage: fmt(cert.baseCaseMinCoverage),
    stressedMinCoverage: fmt(cert.stressedMinCoverage),
    policyApprovable: policyEval.approvable,
    policyChecks: policyEval.checks.map((c) => ({ rule: c.ruleId, status: c.status })),
  };
}
