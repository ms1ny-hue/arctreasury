import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

/**
 * Read-only view over the indexer's durable store (the same SQLite file the
 * Arc indexer/reconciliation worker writes). Lets MCP report persisted
 * proposal status and reconciliation without any write path.
 */
const DB_PATH = process.env.INDEXER_DB ?? new URL("../../indexer/.data/indexer.sqlite", import.meta.url).pathname;

export function reconAvailable(): boolean {
  return existsSync(DB_PATH);
}

function open(): DatabaseSync | null {
  if (!existsSync(DB_PATH)) return null;
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

export function proposalStatus(proposalId: string): { state: string; events: { name: string; tx: string; block: number }[] } | { error: string } {
  const db = open();
  if (!db) return { error: "indexer store not present; run the indexer worker to populate reconciliation data" };
  const rows = db.prepare("SELECT event_name, tx_hash, block_number FROM contract_events WHERE proposal_id=? ORDER BY block_number").all(proposalId) as any[];
  db.close();
  const names = new Set(rows.map((r) => r.event_name));
  const state = names.has("executed") ? "executed" : names.has("approved") ? "approved" : names.has("registered") ? "registered" : "unknown";
  return { state, events: rows.map((r) => ({ name: r.event_name, tx: r.tx_hash, block: r.block_number })) };
}

export function reconciliationStatus(proposalId: string): { status: string; detail: string; executeTx: string | null } | { error: string } {
  const db = open();
  if (!db) return { error: "indexer store not present; run the indexer worker" };
  const r = db.prepare("SELECT status, detail, execute_tx FROM reconciliation WHERE proposal_id=?").get(proposalId) as any;
  db.close();
  return r ? { status: r.status, detail: r.detail, executeTx: r.execute_tx } : { error: "no reconciliation record for that proposal id" };
}
