import { Store } from "./store.js";
import { Indexer } from "./indexer.js";

/**
 * Dedicated Arc indexer / reconciliation worker. Runs OUTSIDE the web app (a
 * Vercel function cannot hold a durable connection). Resumes from the persisted
 * block cursor after restart, backfills missed blocks over HTTP, then watches
 * live over WebSocket.
 *
 *   pnpm --filter @arctreasury/indexer start          # continuous
 *   pnpm --filter @arctreasury/indexer reconcile      # backfill + reconcile once, then exit
 */
const DB_PATH = process.env.INDEXER_DB ?? new URL("../.data/indexer.sqlite", import.meta.url).pathname;
const once = process.argv.includes("--once");

async function main() {
  const store = new Store(DB_PATH);
  const ix = new Indexer(store);
  console.log(`indexer db: ${DB_PATH}`);

  await ix.backfill();
  const s = store.stats();
  console.log(`store: ${s.events} events, ${s.reconciled} reconciled (${s.matched} matched)`);
  for (const r of store.listReconciliations().slice(0, 8)) console.log(`  ${r.status.padEnd(10)} ${r.proposalId.slice(0, 18)}…  ${r.executeTx ?? ""}`);

  if (once) { console.log("done (--once)."); return; }

  let stop = () => {};
  try { stop = await ix.watch(); } catch (e) { console.log(`ws unavailable (${(e as Error).message.split("\n")[0]}); polling backfill every 12s`); }
  const poll = setInterval(() => ix.backfill().catch((e) => console.log("backfill err:", (e as Error).message.split("\n")[0])), 12_000);
  const shutdown = () => { clearInterval(poll); stop(); console.log("\nshutting down; cursor persisted."); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
