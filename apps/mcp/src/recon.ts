import { isConfigured, getPool, eventsForProposal } from "@arctreasury/db";

/**
 * Read-only views over the SHARED Neon Postgres (the same DB the indexer worker
 * and web app write). No write path from MCP.
 */
export function reconAvailable(): boolean {
  return isConfigured();
}

export async function proposalStatus(proposalId: string): Promise<{ state: string; events: { name: string; tx: string; block: number }[] } | { error: string }> {
  if (!isConfigured()) return { error: "shared database not configured (DATABASE_URL unset)" };
  const events = await eventsForProposal(proposalId);
  const names = new Set(events.map((e) => e.eventName));
  const state = names.has("executed") ? "executed" : names.has("approved") ? "approved" : names.has("registered") ? "registered" : "unknown";
  return { state, events: events.map((e) => ({ name: e.eventName, tx: e.txHash, block: e.blockNumber })) };
}

export async function reconciliationStatus(proposalId: string): Promise<{ status: string; detail: string; finality: string; confirmations: number; executeTx: string | null } | { error: string }> {
  if (!isConfigured()) return { error: "shared database not configured" };
  const r = (await getPool().query("SELECT status,detail,finality,confirmations,execute_tx FROM reconciliation WHERE proposal_id=$1", [proposalId])).rows[0];
  return r ? { status: r.status, detail: r.detail, finality: r.finality, confirmations: r.confirmations, executeTx: r.execute_tx } : { error: "no reconciliation record" };
}
