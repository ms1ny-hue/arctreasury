import { NextResponse } from "next/server";
import { isConfigured, approveProposal, StateConflict } from "@arctreasury/db";

export const dynamic = "force-dynamic";
const ORG = "demo-org";

/**
 * Human approval, persisted. Compare-and-set: only awaiting_approval →
 * approved succeeds; a second approval (or an approval of a superseded/unknown
 * proposal) returns 409. Prevents duplicate approvals.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return NextResponse.json({ error: "persistence not configured" }, { status: 503 });
  const { id } = await ctx.params;
  let body: { approver?: string; signature?: string };
  try { body = await req.json().catch(() => ({})); } catch { body = {}; }
  const approver = body.approver ?? "0xhuman";
  try {
    const p = await approveProposal(ORG, id, approver, body.signature ?? null);
    return NextResponse.json({ proposalId: p.id, state: p.state, approver });
  } catch (e) {
    if (e instanceof StateConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
