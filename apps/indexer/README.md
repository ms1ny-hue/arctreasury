# @arctreasury/indexer

Dedicated Arc Testnet indexer and reconciliation worker. Runs **outside** the web
app (a serverless function cannot hold a durable connection). Persists to a real
SQL store (Node's built-in `node:sqlite`, durable file) — a Postgres DDL is in
`schema.pg.sql` for a hosted deployment.

```bash
pnpm --filter @arctreasury/indexer reconcile   # backfill + reconcile once, exit
pnpm --filter @arctreasury/indexer start        # continuous (WebSocket + poll)
```

Behavior: resumes from the persisted block cursor after restart; backfills missed
blocks over HTTP RPC (chunked); dedups events by (chainId, txHash, logIndex);
purges and replays a block whose hash changed (reorg); reconciles each
`ProposalExecuted` event against the contract's stored proposal (destination +
amount + executed flag + certificate commitment) — a submitted transaction is
never marked settled until the confirmed event agrees with on-chain state.

Reconciliation states: pending, matched, mismatched, failed, reorged.
