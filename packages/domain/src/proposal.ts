import { hashValue } from "./hash.js";
import type {
  Approval,
  AuditEvent,
  Epoch,
  Execution,
  LiquidityActionProposal,
  LiquidityRecommendation,
  PolicyEvaluation,
  ProposalState,
} from "./entities.js";
import type { VerificationResult } from "./verifier.js";

/**
 * Proposal state machine + append-only audit hash chain.
 *
 * Lifecycle: draft -> evaluated -> awaiting_approval -> approved -> executing
 *            -> settled | failed | expired | invalidated
 *
 * A proposal reaches `awaiting_approval` ONLY if policy is approvable AND the
 * independent verifier passed. Approval binds a snapshot of the critical
 * hashes; if any of them change before execution the approval is invalidated
 * and the money cannot move. Nothing here can approve, sign, or execute on its
 * own — those are explicit, human-driven calls.
 */
const ALLOWED: Record<ProposalState, ProposalState[]> = {
  draft: ["evaluated", "invalidated"],
  evaluated: ["awaiting_approval", "invalidated", "expired"],
  awaiting_approval: ["approved", "invalidated", "expired"],
  approved: ["executing", "invalidated", "expired"],
  executing: ["settled", "failed"],
  settled: [],
  failed: [],
  expired: [],
  invalidated: [],
};

function canTransition(from: ProposalState, to: ProposalState): boolean {
  return ALLOWED[from].includes(to);
}

function appendAudit(
  audit: AuditEvent[],
  at: Epoch,
  kind: string,
  detail: string
): AuditEvent[] {
  const prevHash = audit.length ? audit[audit.length - 1]!.hash : "0x0";
  const seq = audit.length;
  const hash = hashValue({ seq, at, kind, detail, prevHash });
  return [...audit, { seq, at, kind, detail, prevHash, hash }];
}

export interface BoundHashes {
  inputSnapshotHash: string;
  forecastHash: string;
  routeHash: string;
  policyResultHash: string;
  simulationHash: string;
}

export function createProposal(
  rec: LiquidityRecommendation,
  policyEval: PolicyEvaluation,
  verification: VerificationResult,
  simulationHash: string,
  createdAt: Epoch,
  ttlSeconds: number
): LiquidityActionProposal {
  const boundHashes: BoundHashes = {
    inputSnapshotHash: rec.inputSnapshotHash,
    forecastHash: rec.forecastHash,
    routeHash: rec.routeHash,
    policyResultHash: policyEval.resultHash,
    simulationHash,
  };
  const gated = policyEval.approvable && verification.passed;
  let audit = appendAudit([], createdAt, "created", `recommendation ${rec.id}`);
  audit = appendAudit(audit, createdAt, "evaluated", `policy ${policyEval.policyVersion} approvable=${policyEval.approvable}, verifier passed=${verification.passed}`);
  let state: ProposalState = "evaluated";
  if (gated) {
    state = "awaiting_approval";
    audit = appendAudit(audit, createdAt, "awaiting_approval", "policy + independent verification passed");
  } else {
    audit = appendAudit(audit, createdAt, "blocked", "policy failed or verification did not pass; not approvable");
  }
  return {
    id: `prop-${rec.id}`,
    recommendationId: rec.id,
    state,
    action: rec.action,
    policyVersion: policyEval.policyVersion,
    policyEvaluation: policyEval,
    createdAt,
    expiresAt: createdAt + ttlSeconds,
    execution: { status: "none" },
    boundHashes,
    audit,
  };
}

export function isExpired(p: LiquidityActionProposal, now: Epoch): boolean {
  return now > p.expiresAt;
}

/** Approve. Rejects unless awaiting_approval, unexpired, and hashes unchanged. */
export function approveProposal(
  p: LiquidityActionProposal,
  approver: string,
  now: Epoch,
  currentHashes: BoundHashes,
  signature?: string
): LiquidityActionProposal {
  if (p.state !== "awaiting_approval") {
    throw new Error(`Cannot approve from state '${p.state}'`);
  }
  if (isExpired(p, now)) {
    return transition(p, "expired", now, "approval attempted after expiry");
  }
  if (!hashesEqual(p.boundHashes, currentHashes)) {
    return transition(p, "invalidated", now, "bound inputs changed before approval");
  }
  const approval: Approval = signature
    ? { approver, approvedAt: now, signature }
    : { approver, approvedAt: now };
  const audit = appendAudit(p.audit, now, "approved", `approver ${approver}`);
  return { ...p, state: "approved", approval, audit };
}

/**
 * Pre-execution guard. Re-checks state, expiry, and every bound hash right
 * before touching the chain. Returns a blocked reason instead of throwing so
 * the caller can surface it. This is the last line before money moves.
 */
export function guardExecution(
  p: LiquidityActionProposal,
  now: Epoch,
  currentHashes: BoundHashes
): { ok: true } | { ok: false; reason: string } {
  if (p.state !== "approved") return { ok: false, reason: `state is '${p.state}', not 'approved'` };
  if (isExpired(p, now)) return { ok: false, reason: "proposal expired" };
  if (!hashesEqual(p.boundHashes, currentHashes)) return { ok: false, reason: "bound inputs changed since approval (stale approval)" };
  return { ok: true };
}

export function beginExecution(p: LiquidityActionProposal, now: Epoch): LiquidityActionProposal {
  if (!canTransition(p.state, "executing")) throw new Error(`Cannot execute from '${p.state}'`);
  const audit = appendAudit(p.audit, now, "executing", "submitting to chain");
  return { ...p, state: "executing", execution: { ...p.execution, status: "submitted", submittedAt: now }, audit };
}

export function settleExecution(
  p: LiquidityActionProposal,
  now: Epoch,
  txHash: string,
  blockNumber: number,
  explorerUrl: string
): LiquidityActionProposal {
  if (p.state !== "executing") throw new Error(`Cannot settle from '${p.state}'`);
  const audit = appendAudit(p.audit, now, "settled", `tx ${txHash} block ${blockNumber}`);
  const execution: Execution = { status: "confirmed", txHash, blockNumber, explorerUrl, confirmedAt: now };
  if (p.execution.submittedAt !== undefined) execution.submittedAt = p.execution.submittedAt;
  return { ...p, state: "settled", execution, audit };
}

export function failExecution(p: LiquidityActionProposal, now: Epoch, reason: string): LiquidityActionProposal {
  const audit = appendAudit(p.audit, now, "failed", reason);
  return { ...p, state: "failed", execution: { ...p.execution, status: "failed" }, audit };
}

export function invalidate(p: LiquidityActionProposal, now: Epoch, reason: string): LiquidityActionProposal {
  return transition(p, "invalidated", now, reason);
}

function transition(p: LiquidityActionProposal, to: ProposalState, now: Epoch, detail: string): LiquidityActionProposal {
  if (!canTransition(p.state, to)) throw new Error(`Illegal transition ${p.state} -> ${to}`);
  const audit = appendAudit(p.audit, now, to, detail);
  return { ...p, state: to, audit };
}

export function hashesEqual(a: BoundHashes, b: BoundHashes): boolean {
  return (
    a.inputSnapshotHash === b.inputSnapshotHash &&
    a.forecastHash === b.forecastHash &&
    a.routeHash === b.routeHash &&
    a.policyResultHash === b.policyResultHash &&
    a.simulationHash === b.simulationHash
  );
}

/** Verify the audit hash chain is intact (tamper-evident). */
export function verifyAuditChain(audit: AuditEvent[]): boolean {
  let prev = "0x0";
  for (const e of audit) {
    const expected = hashValue({ seq: e.seq, at: e.at, kind: e.kind, detail: e.detail, prevHash: prev });
    if (e.prevHash !== prev || e.hash !== expected) return false;
    prev = e.hash;
  }
  return true;
}
