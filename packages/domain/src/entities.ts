import type { Money } from "./money.js";

/**
 * Domain entities. Timestamps are epoch SECONDS (integers) so the whole engine
 * is deterministic and hashable. No Date.now() inside the engine: the caller
 * passes an explicit `asOf` clock.
 */
export type Epoch = number;
export type ScenarioKind = "base" | "downside" | "severe";
export type DataStatus = "live" | "testnet" | "simulated" | "demo";

export interface DataFreshnessAssertion {
  source: string;
  observedAt: Epoch;
  asOf: Epoch;
  maxAgeSeconds: number;
  status: DataStatus;
  stale: boolean;
}

export interface LiquidityPool {
  id: string;
  label: string;
  /** Settlement wallet address this pool maps to (checksummed). */
  walletAddress: string;
  corridorId: string;
  balance: Money;
  /** Minimum operating reserve that must never be spent below (base case). */
  operatingReserve: Money;
  /** Additional reserve that must survive the stressed scenario. */
  stressedReserve: Money;
}

export interface SettlementCorridor {
  id: string;
  label: string;
  counterparty: string;
  /** true => obligations here are contractual and mandatory to cover. */
  mandatory: boolean;
}

/** A dated contractual outflow (merchant settlement, contractor payout, fee). */
export interface SettlementObligation {
  id: string;
  corridorId: string;
  poolId: string;
  kind: "merchant_settlement" | "contractor_payout" | "fee" | "reserve";
  amount: Money;
  /** Value time the funds must be available BY (settlement window close). */
  dueAt: Epoch;
  slaAt: Epoch;
  mandatory: boolean;
  description: string;
}

/** A dated inflow OR outflow used to build the forecast. */
export interface CashFlowEvent {
  id: string;
  poolId: string;
  corridorId: string;
  direction: "inflow" | "outflow";
  amount: Money;
  /** Expected value time (when economically available / due). */
  valueAt: Epoch;
  /** Scheduled vs at-risk (e.g. a receivable that may be delayed). */
  certainty: "scheduled" | "expected" | "at_risk";
  source: string;
  description: string;
}

export type RailState =
  | "planned"
  | "pending"
  | "initiated"
  | "submitted"
  | "confirmed"
  | "available"
  | "failed"
  | "reversed"
  | "held";

export interface FundingRail {
  id: string;
  label: string;
  sourceAsset: string;
  destAsset: string;
  sourceNetwork: string;
  destNetwork: string;
  /** Expected and conservative completion in seconds. */
  expectedCompletionSec: number;
  conservativeCompletionSec: number;
  finalityCondition: string;
  feeBps: number;
  minSize: Money;
  maxSize: Money;
  health: "healthy" | "degraded" | "down";
  counterparty: string;
  provider: string;
  provenance: string;
  lastUpdatedAt: Epoch;
}

export interface RailAvailabilityWindow {
  railId: string;
  /** Rail is usable only inside [opensAt, cutoffAt]; else next window. */
  opensAt: Epoch;
  cutoffAt: Epoch;
  note: string;
}

export interface ExecutionRoute {
  id: string;
  railId: string;
  sourcePoolId: string;
  destPoolId: string;
  riskPenaltyBps: number;
}

// --- Policy ---
export interface PolicyThresholds {
  maxSingleTransaction: Money;
  maxDailyAggregate: Money;
  minSettlementCoverageRatioBps: number; // e.g. 10000 = 100%
  approvedDestinations: string[]; // checksummed addresses allowlist
  approvedInstruments: string[]; // rail ids allowlist
  counterpartyConcentrationBps: number;
  proposalTtlSeconds: number;
  twoPersonThreshold: Money;
}

export interface PolicyVersion {
  policyId: string;
  version: string;
  effectiveAt: Epoch;
  thresholds: PolicyThresholds;
}

export type PolicyCheckStatus = "pass" | "fail" | "warning";
export interface PolicyCheck {
  ruleId: string;
  policyVersion: string;
  status: PolicyCheckStatus;
  observedValue: string;
  threshold: string;
  unit: string;
  reason: string;
  evidenceRefs: string[];
}
export interface PolicyEvaluation {
  policyVersion: string;
  evaluatedAt: Epoch;
  checks: PolicyCheck[];
  approvable: boolean;
  resultHash: string;
}

// --- Forecast ---
export interface ForecastPoint {
  at: Epoch;
  poolId: string;
  openingBalance: Money;
  inflow: Money;
  outflow: Money;
  closingBalance: Money;
  requiredReserve: Money;
  coverageShortfall: Money; // >0 means uncovered obligation at this step
}
export interface ForecastSeries {
  poolId: string;
  scenario: ScenarioKind;
  points: ForecastPoint[];
  minBalance: Money;
  minBalanceAt: Epoch;
  timeToShortfallSec: number | null; // null => never breaches within horizon
  requiredTopUp: Money; // smallest top-up restoring coverage
  maxSafeRelease: Money; // largest safe excess release
}
export interface ForecastRun {
  id: string;
  asOf: Epoch;
  horizonHours: number;
  stepSeconds: number;
  scenario: ScenarioKind;
  series: ForecastSeries[];
  inputSnapshotHash: string;
  forecastHash: string;
}

// --- Recommendation / proposal ---
export interface LiquidityAction {
  kind: "rebalance" | "topup" | "release";
  sourcePoolId: string;
  destPoolId: string;
  railId: string;
  amount: Money;
}
export interface LiquidityRecommendation {
  id: string;
  createdAt: Epoch;
  action: LiquidityAction;
  authoritativeAmount: Money;
  maxSafeAmount: Money;
  latestSafeExecutionAt: Epoch;
  bindingConstraint: string;
  consequenceOfInaction: string;
  coveredObligationIds: string[];
  inputSnapshotHash: string;
  forecastHash: string;
  routeHash: string;
  optimizerStatus: OptimizerStatus;
}

export type OptimizerStatus =
  | "optimal"
  | "feasible_not_proven_optimal"
  | "infeasible";

export type ProposalState =
  | "draft"
  | "evaluated"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "settled"
  | "failed"
  | "expired"
  | "invalidated";

export interface Approval {
  approver: string; // wallet address or actor id
  approvedAt: Epoch;
  signature?: string;
}
export interface Execution {
  txHash?: string;
  blockNumber?: number;
  explorerUrl?: string;
  submittedAt?: Epoch;
  confirmedAt?: Epoch;
  status: "none" | "submitted" | "confirmed" | "failed";
}
export interface AuditEvent {
  seq: number;
  at: Epoch;
  kind: string;
  detail: string;
  prevHash: string;
  hash: string;
}
export interface LiquidityActionProposal {
  id: string;
  recommendationId: string;
  state: ProposalState;
  action: LiquidityAction;
  policyVersion: string;
  policyEvaluation: PolicyEvaluation;
  createdAt: Epoch;
  expiresAt: Epoch;
  approval?: Approval;
  execution: Execution;
  certificateId?: string;
  /** Hashes bound at proposal creation; approval invalidates if any change. */
  boundHashes: {
    inputSnapshotHash: string;
    forecastHash: string;
    routeHash: string;
    policyResultHash: string;
    simulationHash: string;
  };
  audit: AuditEvent[];
}

// --- Certificate ---
export interface CoverageByPool {
  poolId: string;
  corridorId: string;
  amount: Money;
}
export interface SettlementCoverageCertificate {
  certificateId: string;
  schemaVersion: string;
  asOf: Epoch;
  dataFreshness: DataStatus;
  coveredObligationIds: string[];
  settlementWindows: { obligationId: string; dueAt: Epoch }[];
  preActionLiquidity: CoverageByPool[];
  postActionLiquidity: CoverageByPool[];
  baseCaseMinCoverage: Money;
  stressedMinCoverage: Money;
  latestSafeExecutionAt: Epoch;
  recommendedAmount: Money;
  maxSafeAmount: Money;
  bindingConstraints: string[];
  policyVersion: string;
  policyResultHash: string;
  inputSnapshotHash: string;
  forecastHash: string;
  routeHash: string;
  simulationHash: string;
  railAssumptions: string[];
  approver?: string;
  approvalAt?: Epoch;
  txRef?: string;
  receiptRef?: string;
  validFrom: Epoch;
  validUntil: Epoch;
  invalidationReason?: string;
  /** SHA-256 of canonical JSON of everything above except this field. */
  commitment: string;
}

export interface TreasuryScenarioData {
  accountId: string;
  asOf: Epoch;
  pools: LiquidityPool[];
  corridors: SettlementCorridor[];
  obligations: SettlementObligation[];
  cashFlows: CashFlowEvent[];
  rails: FundingRail[];
  railWindows: RailAvailabilityWindow[];
  routes: ExecutionRoute[];
  policy: PolicyVersion;
  dataStatus: DataStatus;
}
