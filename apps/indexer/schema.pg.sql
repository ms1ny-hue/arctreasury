-- Postgres DDL mirroring the node:sqlite store, for a hosted deployment.
-- Swap the SQLite Store adapter for a pg-backed one implementing the same interface.
CREATE TABLE IF NOT EXISTS block_cursor (
  chain_id BIGINT PRIMARY KEY, last_block BIGINT NOT NULL, last_hash TEXT, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS contract_events (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL, block_hash TEXT NOT NULL,
  event_name TEXT NOT NULL, proposal_id TEXT NOT NULL,
  destination TEXT, amount TEXT,
  source_system TEXT NOT NULL, observed_at BIGINT NOT NULL, ingested_at BIGINT NOT NULL,
  classification TEXT NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS arc_transactions (
  tx_hash TEXT PRIMARY KEY, block_number BIGINT, status TEXT, confirmations INTEGER, updated_at BIGINT
);
CREATE TABLE IF NOT EXISTS reconciliation (
  proposal_id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, execute_tx TEXT,
  onchain_commitment TEXT, onchain_executed BOOLEAN, checked_at BIGINT NOT NULL
);
