import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durable event store. Uses Node's built-in SQLite (node:sqlite) so the worker
 * has real relational persistence that survives restart with zero external
 * services. The same schema is provided as Postgres DDL (schema.pg.sql) for a
 * hosted deployment; swap this adapter for a pg-backed one by implementing the
 * Store interface. Every event carries provenance and a dedup key.
 */
export interface ContractEventRow {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  eventName: string;
  proposalId: string;
  destination: string | null;
  amount: string | null;
  sourceSystem: string;
  observedAt: number;
  ingestedAt: number;
  classification: string;
}

export type ReconStatus = "pending" | "matched" | "mismatched" | "failed" | "reorged";

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS block_cursor (
        chain_id INTEGER PRIMARY KEY, last_block INTEGER NOT NULL, last_hash TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_events (
        id TEXT PRIMARY KEY,               -- chainId:txHash:logIndex
        chain_id INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL, block_hash TEXT NOT NULL,
        event_name TEXT NOT NULL, proposal_id TEXT NOT NULL,
        destination TEXT, amount TEXT,
        source_system TEXT NOT NULL, observed_at INTEGER NOT NULL, ingested_at INTEGER NOT NULL,
        classification TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_event ON contract_events(chain_id, tx_hash, log_index);
      CREATE TABLE IF NOT EXISTS arc_transactions (
        tx_hash TEXT PRIMARY KEY, block_number INTEGER, status TEXT, confirmations INTEGER, updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS reconciliation (
        proposal_id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, execute_tx TEXT,
        onchain_commitment TEXT, onchain_executed INTEGER, checked_at INTEGER NOT NULL
      );
    `);
  }

  getCursor(chainId: number): { lastBlock: number; lastHash: string | null } | null {
    const r = this.db.prepare("SELECT last_block, last_hash FROM block_cursor WHERE chain_id=?").get(chainId) as
      | { last_block: number; last_hash: string | null } | undefined;
    return r ? { lastBlock: r.last_block, lastHash: r.last_hash } : null;
  }
  setCursor(chainId: number, block: number, hash: string): void {
    this.db.prepare(
      "INSERT INTO block_cursor(chain_id,last_block,last_hash,updated_at) VALUES(?,?,?,?) ON CONFLICT(chain_id) DO UPDATE SET last_block=excluded.last_block, last_hash=excluded.last_hash, updated_at=excluded.updated_at"
    ).run(chainId, block, hash, Date.now());
  }

  /** Insert an event; returns true if newly inserted, false if a duplicate. */
  putEvent(e: ContractEventRow): boolean {
    const id = `${e.chainId}:${e.txHash}:${e.logIndex}`;
    const info = this.db.prepare(
      `INSERT OR IGNORE INTO contract_events
       (id,chain_id,tx_hash,log_index,block_number,block_hash,event_name,proposal_id,destination,amount,source_system,observed_at,ingested_at,classification)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, e.chainId, e.txHash, e.logIndex, e.blockNumber, e.blockHash, e.eventName, e.proposalId, e.destination, e.amount, e.sourceSystem, e.observedAt, e.ingestedAt, e.classification);
    return info.changes === 1;
  }

  /** Remove events at a block whose hash changed (reorg) so they can be replayed. */
  purgeBlock(chainId: number, blockNumber: number, keepHash: string): number {
    const info = this.db.prepare("DELETE FROM contract_events WHERE chain_id=? AND block_number=? AND block_hash<>?").run(chainId, blockNumber, keepHash);
    return info.changes as number;
  }

  eventsForProposal(pid: string): ContractEventRow[] {
    return this.db.prepare("SELECT * FROM contract_events WHERE proposal_id=? ORDER BY block_number").all(pid).map((r: any) => ({
      chainId: r.chain_id, txHash: r.tx_hash, logIndex: r.log_index, blockNumber: r.block_number, blockHash: r.block_hash,
      eventName: r.event_name, proposalId: r.proposal_id, destination: r.destination, amount: r.amount,
      sourceSystem: r.source_system, observedAt: r.observed_at, ingestedAt: r.ingested_at, classification: r.classification,
    }));
  }

  putArcTx(txHash: string, blockNumber: number | null, status: string, confirmations: number): void {
    this.db.prepare("INSERT INTO arc_transactions(tx_hash,block_number,status,confirmations,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(tx_hash) DO UPDATE SET block_number=excluded.block_number,status=excluded.status,confirmations=excluded.confirmations,updated_at=excluded.updated_at")
      .run(txHash, blockNumber, status, confirmations, Date.now());
  }

  putReconciliation(pid: string, status: ReconStatus, detail: string, executeTx: string | null, commitment: string | null, executed: boolean | null): void {
    this.db.prepare("INSERT INTO reconciliation(proposal_id,status,detail,execute_tx,onchain_commitment,onchain_executed,checked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(proposal_id) DO UPDATE SET status=excluded.status,detail=excluded.detail,execute_tx=excluded.execute_tx,onchain_commitment=excluded.onchain_commitment,onchain_executed=excluded.onchain_executed,checked_at=excluded.checked_at")
      .run(pid, status, detail, executeTx, commitment, executed === null ? null : executed ? 1 : 0, Date.now());
  }
  getReconciliation(pid: string): { status: ReconStatus; detail: string; executeTx: string | null } | null {
    const r = this.db.prepare("SELECT status,detail,execute_tx FROM reconciliation WHERE proposal_id=?").get(pid) as any;
    return r ? { status: r.status, detail: r.detail, executeTx: r.execute_tx } : null;
  }
  listReconciliations(): { proposalId: string; status: ReconStatus; executeTx: string | null }[] {
    return this.db.prepare("SELECT proposal_id,status,execute_tx FROM reconciliation ORDER BY checked_at DESC").all().map((r: any) => ({ proposalId: r.proposal_id, status: r.status, executeTx: r.execute_tx }));
  }
  stats(): { events: number; reconciled: number; matched: number } {
    const e = (this.db.prepare("SELECT COUNT(*) c FROM contract_events").get() as any).c;
    const r = (this.db.prepare("SELECT COUNT(*) c FROM reconciliation").get() as any).c;
    const m = (this.db.prepare("SELECT COUNT(*) c FROM reconciliation WHERE status='matched'").get() as any).c;
    return { events: e, reconciled: r, matched: m };
  }
}
