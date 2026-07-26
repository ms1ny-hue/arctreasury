import { NextResponse } from "next/server";
import { isConfigured, status } from "@arctreasury/db";

export const dynamic = "force-dynamic";

/** Diagnostics: database type, migration version, last indexed block, worker heartbeat, latest reconciliation. */
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ database: "none", note: "DATABASE_URL not configured; persistence disabled", environment: process.env.VERCEL_ENV ?? "local" });
  try {
    const s = await status();
    return NextResponse.json({ ...s, environment: process.env.VERCEL_ENV ?? "local" });
  } catch (e) {
    return NextResponse.json({ database: "neon-postgres", error: (e as Error).message }, { status: 500 });
  }
}
