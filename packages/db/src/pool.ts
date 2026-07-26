import { Pool } from "pg";

/**
 * Postgres connection. Runtime traffic uses the POOLED url (DATABASE_URL);
 * migrations and the long-lived worker use the DIRECT/unpooled url. Neon injects
 * both. Never logged or printed.
 */
export function runtimeUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}
export function directUrl(): string | undefined {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? runtimeUrl();
}
export function isConfigured(): boolean {
  return !!runtimeUrl();
}

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    const cs = runtimeUrl();
    if (!cs) throw new Error("DATABASE_URL not configured");
    _pool = new Pool({ connectionString: cs, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  }
  return _pool;
}
