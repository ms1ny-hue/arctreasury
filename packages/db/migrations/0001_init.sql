-- ArcTreasury shared schema (Neon Postgres). Versioned; applied by migrate.ts.
-- Tenant isolation: every operational row is scoped to org_id + env_id.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environments (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  chain_id   BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- Imported source datasets (a company's settlement position at a point in time).
CREATE TABLE IF NOT EXISTS datasets (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  env_id        TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL,
  as_of         BIGINT NOT NULL,
  data_status   TEXT NOT NULL,
  source_system TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  payload       JSONB NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_hash)          -- idempotent import
);
CREATE INDEX IF NOT EXISTS ix_datasets_org ON datasets(org_id, env_id);

-- Proposals: a decision with a compare-and-set state machine.
CREATE TABLE IF NOT EXISTS proposals (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  env_id           TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  dataset_id       TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  proposal_id_hash TEXT UNIQUE,           -- on-chain bytes32 once assigned
  source_pool      TEXT NOT NULL,
  dest_pool        TEXT NOT NULL,
  dest_address     TEXT NOT NULL,
  amount_atomic    TEXT NOT NULL,         -- integer atomic units (no float)
  rail             TEXT NOT NULL,
  policy_hash      TEXT NOT NULL,
  forecast_hash    TEXT NOT NULL,
  input_hash       TEXT NOT NULL,
  cert_commitment  TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'awaiting_approval',
  superseded       BOOLEAN NOT NULL DEFAULT false,
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state IN ('draft','awaiting_approval','approved','executing','settled','failed','expired','invalidated','superseded'))
);
CREATE INDEX IF NOT EXISTS ix_proposals_org ON proposals(org_id, env_id, state);

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  approver    TEXT NOT NULL,
  signature   TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id)                    -- one approval per proposal
);

CREATE TABLE IF NOT EXISTS arc_transactions (
  tx_hash       TEXT PRIMARY KEY,
  proposal_id   TEXT REFERENCES proposals(id) ON DELETE SET NULL,
  block_number  BIGINT,
  status        TEXT,
  confirmations INTEGER,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_events (
  id             TEXT PRIMARY KEY,        -- chainId:txHash:logIndex
  chain_id       BIGINT NOT NULL,
  tx_hash        TEXT NOT NULL,
  log_index      INTEGER NOT NULL,
  block_number   BIGINT NOT NULL,
  block_hash     TEXT NOT NULL,
  event_name     TEXT NOT NULL,
  proposal_id    TEXT NOT NULL,
  destination    TEXT,
  amount         TEXT,
  source_system  TEXT NOT NULL,
  observed_at    BIGINT NOT NULL,
  ingested_at    BIGINT NOT NULL,
  classification TEXT NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)   -- dedup
);
CREATE INDEX IF NOT EXISTS ix_events_proposal ON contract_events(proposal_id);

CREATE TABLE IF NOT EXISTS reconciliation (
  proposal_id        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,        -- pending|matched|mismatched|failed|reorged
  detail             TEXT,
  execute_tx         TEXT,
  onchain_commitment TEXT,
  onchain_executed   BOOLEAN,
  confirmations      INTEGER,
  finality           TEXT,                 -- submitted|mined|confirmed|finalized|failed|reorged
  checked_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE CASCADE,
  commitment  TEXT NOT NULL,
  bundle      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS block_cursor (
  chain_id   BIGINT PRIMARY KEY,
  last_block BIGINT NOT NULL,
  last_hash  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  worker_id  TEXT,
  last_block BIGINT,
  last_beat  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
