import { NextResponse } from "next/server";
import { isConfigured, proposalHistory } from "@arctreasury/db";

export const dynamic = "force-dynamic";
const ORG = "demo-org";

/** Full persisted history for a proposal (survives redeploy and browser sessions). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return NextResponse.json({ error: "persistence not configured" }, { status: 503 });
  const { id } = await ctx.params;
  const h = await proposalHistory(ORG, id);
  if (!h.proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    proposal: {
      id: h.proposal.id, state: h.proposal.state, destPool: h.proposal.dest_pool, destAddress: h.proposal.dest_address,
      amountAtomic: h.proposal.amount_atomic, rail: h.proposal.rail, certCommitment: h.proposal.cert_commitment,
      proposalIdHash: h.proposal.proposal_id_hash, superseded: h.proposal.superseded,
      createdAt: h.proposal.created_at, updatedAt: h.proposal.updated_at,
    },
    approval: h.approval, reconciliation: h.reconciliation, transaction: h.tx,
  });
}
