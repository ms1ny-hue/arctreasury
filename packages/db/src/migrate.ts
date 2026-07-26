import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { directUrl } from "./pool.js";

/**
 * Versioned migration runner. Applies any migrations/*.sql not yet recorded in
 * schema_migrations, each in its own transaction. Idempotent: re-running is a
 * no-op. Uses the DIRECT (unpooled) connection.
 */
const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(): Promise<{ applied: string[]; current: string }> {
  const cs = directUrl();
  if (!cs) throw new Error("DATABASE_URL not configured");
  const client = new Client({ connectionString: cs });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version as string));
    const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(MIG_DIR, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
    const current = (await client.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")).rows[0]?.version ?? "none";
    return { applied, current };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then((r) => { console.log("applied:", r.applied.length ? r.applied.join(", ") : "(none)", "| current:", r.current); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
