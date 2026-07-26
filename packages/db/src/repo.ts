import { getPool } from "./pool.js";

/** Conflict raised when a compare-and-set state transition does not apply. */
export class StateConflict extends Error {
  constructor(msg: string) { super(msg); this.name = "StateConflict"; }
}

export interface ProposalRow {
  id: string; org_id: string; env_id: string; dataset_id: string; proposal_id_hash: string | null;
  source_pool: string; dest_pool: string; dest_address: string; amount_atomic: string; rail: string;
  policy_hash: string; forecast_hash: string; input_hash: string; cert_commitment: string;
  state: string; superseded: boolean; created_at: string; updated_at: string;
}

const q = () => getPool();

export async function ensureOrg(id: string, name: string): Promise<void> {
  await q().query("INSERT INTO organizations(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, name]);
}
export async function ensureEnv(id: string, orgId: string, name: string, chainId: number): Promise<void> {
  await q().query("INSERT INTO environments(id,org_id,name,chain_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [id, orgId, name, chainId]);
}

export async function insertDataset(d: { id: string; orgId: string; envId: string; accountId: string; asOf: number; dataStatus: string; sourceSystem: string; snapshotHash: string; payload: unknown }): Promise<string> {
  const r = await q().query(
    `INSERT INTO datasets(id,org_id,env_id,account_id,as_of,data_status,source_system,snapshot_hash,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(org_id,snapshot_hash) DO UPDATE SET account_id=EXCLUDED.account_id
     RETURNING id`,
    [d.id, d.orgId, d.envId, d.accountId, d.asOf, d.dataStatus, d.sourceSystem, d.snapshotHash, JSON.stringify(d.payload)]
  );
  return r.rows[0].id as string;
}

export async function createProposal(p: {
  id: string; orgId: string; envId: string; datasetId: string; sourcePool: string; destPool: string; destAddress: string;
  amountAtomic: string; rail: string; policyHash: string; forecastHash: string; inputHash: string; certCommitment: string; idempotencyKey: string;
}): Promise<ProposalRow> {
  const ins = await q().query(
    `INSERT INTO proposals(id,org_id,env_id,dataset_id,source_pool,dest_pool,dest_address,amount_atomic,rail,policy_hash,forecast_hash,input_hash,cert_commitment,idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,
    [p.id, p.orgId, p.envId, p.datasetId, p.sourcePool, p.destPool, p.destAddress, p.amountAtomic, p.rail, p.policyHash, p.forecastHash, p.inputHash, p.certCommitment, p.idempotencyKey]
  );
  if (ins.rows[0]) return ins.rows[0] as ProposalRow;
  const ex = await q().query("SELECT * FROM proposals WHERE idempotency_key=$1", [p.idempotencyKey]);
  return ex.rows[0] as ProposalRow;
}

export async function getProposal(orgId: string, id: string): Promise<ProposalRow | null> {
  const r = await q().query("SELECT * FROM proposals WHERE id=$1 AND org_id=$2", [id, orgId]);
  return (r.rows[0] as ProposalRow) ?? null;
}
export async function proposalHistory(orgId: string, id: string): Promise<{ proposal: ProposalRow | null; approval: unknown; reconciliation: unknown; tx: unknown }> {
  const proposal = await getProposal(orgId, id);
  if (!proposal) return { proposal: null, approval: null, reconciliation: null, tx: null };
  const approval = (await q().query("SELECT approver,approved_at FROM approvals WHERE proposal_id=$1", [id])).rows[0] ?? null;
  const pid = proposal.proposal_id_hash;
  const reconciliation = pid ? (await q().query("SELECT status,detail,execute_tx,confirmations,finality,checked_at FROM reconciliation WHERE proposal_id=$1", [pid])).rows[0] ?? null : null;
  const tx = (await q().query("SELECT tx_hash,block_number,status,confirmations FROM arc_transactions WHERE proposal_id=$1", [id])).rows[0] ?? null;
  return { proposal, approval, reconciliation, tx };
}

/** CAS: awaiting_approval -> approved. Rejects double / superseded / wrong-state. */
export async function approveProposal(orgId: string, id: string, approver: string, signature: string | null): Promise<ProposalRow> {
  const client = await q().connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      "UPDATE proposals SET state='approved', updated_at=now() WHERE id=$1 AND org_id=$2 AND state='awaiting_approval' AND superseded=false RETURNING *",
      [id, orgId]
    );
    if (upd.rowCount === 0) { await client.query("ROLLBACK"); throw new StateConflict("proposal not in awaiting_approval (already approved, superseded, or unknown)"); }
    await client.query("INSERT INTO approvals(id,proposal_id,approver,signature) VALUES($1,$2,$3,$4) ON CONFLICT(proposal_id) DO NOTHING", [`appr-${id}`, id, approver, signature]);
    await client.query("COMMIT");
    return upd.rows[0] as ProposalRow;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** CAS: approved -> executing. Records the on-chain proposal id hash. */
export async function beginExecuting(orgId: string, id: string, proposalIdHash: string): Promise<ProposalRow> {
  const upd = await q().query(
    "UPDATE proposals SET state='executing', proposal_id_hash=$3, updated_at=now() WHERE id=$1 AND org_id=$2 AND state='approved' AND superseded=false RETURNING *",
    [id, orgId, proposalIdHash]
  );
  if (upd.rowCount === 0) throw new StateConflict("proposal not in approved state");
  return upd.rows[0] as ProposalRow;
}
export async function settleProposal(orgId: string, id: string, txHash: string, block: number): Promise<void> {
  const upd = await q().query("UPDATE proposals SET state='settled', updated_at=now() WHERE id=$1 AND org_id=$2 AND state='executing' RETURNING id", [id, orgId]);
  if (upd.rowCount === 0) throw new StateConflict("proposal not in executing state");
  await q().query("INSERT INTO arc_transactions(tx_hash,proposal_id,block_number,status,confirmations) VALUES($1,$2,$3,'success',0) ON CONFLICT(tx_hash) DO UPDATE SET block_number=EXCLUDED.block_number", [txHash, id, block]);
}

// --- indexer / reconciliation ---
export async function putEvent(e: { chainId: number; txHash: string; logIndex: number; blockNumber: number; blockHash: string; eventName: string; proposalId: string; destination: string | null; amount: string | null; sourceSystem: string; observedAt: number; ingestedAt: number; classification: string }): Promise<boolean> {
  const id = `${e.chainId}:${e.txHash}:${e.logIndex}`;
  const r = await q().query(
    `INSERT INTO contract_events(id,chain_id,tx_hash,log_index,block_number,block_hash,event_name,proposal_id,destination,amount,source_system,observed_at,ingested_at,classification)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [id, e.chainId, e.txHash, e.logIndex, e.blockNumber, e.blockHash, e.eventName, e.proposalId, e.destination, e.amount, e.sourceSystem, e.observedAt, e.ingestedAt, e.classification]
  );
  return (r.rowCount ?? 0) === 1;
}
export async function purgeBlock(chainId: number, blockNumber: number, keepHash: string): Promise<number> {
  const r = await q().query("DELETE FROM contract_events WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3", [chainId, blockNumber, keepHash]);
  return r.rowCount ?? 0;
}
export async function eventsForProposal(pid: string): Promise<{ eventName: string; txHash: string; destination: string | null; amount: string | null; blockNumber: number }[]> {
  const r = await q().query("SELECT event_name,tx_hash,destination,amount,block_number FROM contract_events WHERE proposal_id=$1 ORDER BY block_number", [pid]);
  return r.rows.map((x) => ({ eventName: x.event_name, txHash: x.tx_hash, destination: x.destination, amount: x.amount, blockNumber: x.block_number }));
}
export async function upsertReconciliation(pid: string, status: string, detail: string, executeTx: string | null, commitment: string | null, executed: boolean | null, confirmations: number, finality: string): Promise<void> {
  await q().query(
    `INSERT INTO reconciliation(proposal_id,status,detail,execute_tx,onchain_commitment,onchain_executed,confirmations,finality,checked_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT(proposal_id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,execute_tx=EXCLUDED.execute_tx,onchain_commitment=EXCLUDED.onchain_commitment,onchain_executed=EXCLUDED.onchain_executed,confirmations=EXCLUDED.confirmations,finality=EXCLUDED.finality,checked_at=now()`,
    [pid, status, detail, executeTx, commitment, executed, confirmations, finality]
  );
}
export async function putArcTx(txHash: string, block: number, status: string, confirmations: number): Promise<void> {
  await q().query("INSERT INTO arc_transactions(tx_hash,block_number,status,confirmations) VALUES($1,$2,$3,$4) ON CONFLICT(tx_hash) DO UPDATE SET block_number=EXCLUDED.block_number,status=EXCLUDED.status,confirmations=EXCLUDED.confirmations,updated_at=now()", [txHash, block, status, confirmations]);
}
export async function getCursor(chainId: number): Promise<{ lastBlock: number; lastHash: string | null } | null> {
  const r = await q().query("SELECT last_block,last_hash FROM block_cursor WHERE chain_id=$1", [chainId]);
  return r.rows[0] ? { lastBlock: Number(r.rows[0].last_block), lastHash: r.rows[0].last_hash } : null;
}
export async function setCursor(chainId: number, block: number, hash: string): Promise<void> {
  await q().query("INSERT INTO block_cursor(chain_id,last_block,last_hash,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()", [chainId, block, hash]);
}
export async function heartbeat(workerId: string, block: number): Promise<void> {
  await q().query("INSERT INTO worker_heartbeat(id,worker_id,last_block,last_beat) VALUES(1,$1,$2,now()) ON CONFLICT(id) DO UPDATE SET worker_id=EXCLUDED.worker_id,last_block=EXCLUDED.last_block,last_beat=now()", [workerId, block]);
}

export async function status(): Promise<Record<string, unknown>> {
  const p = getPool();
  const migration = (await p.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")).rows[0]?.version ?? "none";
  const cursor = (await p.query("SELECT chain_id,last_block,updated_at FROM block_cursor ORDER BY updated_at DESC LIMIT 1")).rows[0] ?? null;
  const hb = (await p.query("SELECT worker_id,last_block,last_beat FROM worker_heartbeat WHERE id=1")).rows[0] ?? null;
  const recon = (await p.query("SELECT status,checked_at FROM reconciliation ORDER BY checked_at DESC LIMIT 1")).rows[0] ?? null;
  const counts = (await p.query("SELECT (SELECT count(*) FROM proposals) proposals, (SELECT count(*) FROM contract_events) events, (SELECT count(*) FROM reconciliation WHERE status='matched') matched")).rows[0];
  return { database: "neon-postgres", migration, lastIndexedBlock: cursor?.last_block ? Number(cursor.last_block) : null, cursorUpdatedAt: cursor?.updated_at ?? null, workerHeartbeat: hb ? { workerId: hb.worker_id, lastBlock: Number(hb.last_block), lastBeat: hb.last_beat } : null, latestReconciliation: recon, counts };
}
