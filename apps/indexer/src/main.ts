import { isConfigured, migrate, getPool, status } from "@arctreasury/db";
import { Indexer } from "./indexer.js";

/**
 * Dedicated Arc indexer / reconciliation worker. Runs OUTSIDE the web app (a
 * serverless function cannot hold a durable connection). Persists to the SHARED
 * Neon Postgres (same DB as the web app + MCP). Resumes from the persisted block
 * cursor after restart; backfills over HTTP; watches live over WebSocket.
 *
 *   pnpm --filter @arctreasury/indexer reconcile   # backfill + reconcile once, exit
 *   pnpm --filter @arctreasury/indexer start        # continuous
 */
const once = process.argv.includes("--once");

async function main() {
  if (!isConfigured()) { console.error("DATABASE_URL not set. This worker requires the shared Postgres."); process.exit(1); }
  await migrate(); // idempotent
  const ix = new Indexer();
  const head = await ix.backfill();
  const s = await status();
  console.log(`head ${head} · db ${s.database} · migration ${s.migration} · events ${(s.counts as any)?.events} · matched ${(s.counts as any)?.matched}`);

  if (once) { await getPool().end(); return; }

  let stop = () => {};
  try { stop = await ix.watch(); } catch (e) { console.log(`ws unavailable (${(e as Error).message.split("\n")[0]}); polling every 12s`); }
  const poll = setInterval(() => ix.backfill().catch((e) => console.log("backfill err:", (e as Error).message.split("\n")[0])), 12_000);
  const shutdown = async () => { clearInterval(poll); stop(); await getPool().end().catch(() => {}); console.log("\nshut down; cursor persisted."); process.exit(0); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
