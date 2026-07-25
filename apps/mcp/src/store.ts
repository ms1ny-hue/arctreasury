import {
  northstarScenario,
  recommendRebalance,
  verifyAction,
  evaluatePolicy,
  buildCertificate,
  hashValue,
  type LiquidityActionProposal,
  type LiquidityRecommendation,
  type PolicyEvaluation,
  type SettlementCoverageCertificate,
  type TreasuryScenarioData,
} from "@arctreasury/domain";
import { createProposal } from "@arctreasury/domain";
import type { VerificationResult } from "@arctreasury/domain";

/**
 * In-memory, read/propose-only store backing the MCP server. Proposals created
 * here ALWAYS enter `awaiting_approval`; the MCP surface never exposes approve,
 * sign, or execute. Persistence is a P1 concern; this keeps the P0 boundary
 * honest and side-effect-free beyond process memory.
 */
export interface StoredProposal {
  proposal: LiquidityActionProposal;
  recommendation: LiquidityRecommendation;
  policyEvaluation: PolicyEvaluation;
  verification: VerificationResult;
  certificate: SettlementCoverageCertificate;
}

export class TreasuryStore {
  readonly data: TreasuryScenarioData;
  private readonly proposals = new Map<string, StoredProposal>();

  constructor() {
    this.data = northstarScenario();
  }

  createProposalFromRoute(sourcePoolId: string, destPoolId: string): StoredProposal {
    const rec = recommendRebalance(this.data, { sourcePoolId, destPoolId });
    const policyEvaluation = evaluatePolicy(this.data, rec.action);
    const verification = verifyAction(this.data, rec.action);
    const simulationHash = hashValue({ sim: "mcp", action: rec.action, forecastHash: rec.forecastHash });
    const certificate = buildCertificate(this.data, rec, policyEvaluation, simulationHash);
    const proposal = createProposal(
      rec,
      policyEvaluation,
      verification,
      simulationHash,
      this.data.asOf,
      this.data.policy.thresholds.proposalTtlSeconds
    );
    const stored: StoredProposal = { proposal, recommendation: rec, policyEvaluation, verification, certificate };
    this.proposals.set(proposal.id, stored);
    return stored;
  }

  get(id: string): StoredProposal | undefined {
    return this.proposals.get(id);
  }

  listPending(): StoredProposal[] {
    return [...this.proposals.values()].filter((s) => s.proposal.state === "awaiting_approval");
  }
}
