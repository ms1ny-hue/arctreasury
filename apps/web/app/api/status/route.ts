import { NextResponse } from "next/server";
import { isConfigured, status, latestExecution } from "@arctreasury/db";
import { signerStatus } from "@arctreasury/chain";

export const dynamic = "force-dynamic";

/**
 * Diagnostics: database, migration, last indexed block, worker heartbeat,
 * reconciliation, and the signer/Circle posture. Exposes no secrets — no API
 * key, no entity secret, no full wallet id.
 */
export async function GET() {
  const sig = signerStatus();
  const signer = {
    signerProvider: sig.signerProvider,
    circleConfigured: sig.circleConfigured,
    walletNetwork: sig.walletNetwork, // e.g. ARC-TESTNET blockchain id, or null
    rawKeyReachable: sig.rawKeyReachable, // must be false in production
  };

  if (!isConfigured()) {
    return NextResponse.json({ database: "none", note: "DATABASE_URL not configured; persistence disabled", environment: process.env.VERCEL_ENV ?? "local", signer });
  }
  try {
    const s = await status();
    const exec = await latestExecution();
    return NextResponse.json({
      ...s,
      environment: process.env.VERCEL_ENV ?? "local",
      signer,
      latestExecution: exec ? { signerProvider: exec.signerProvider, circleTransactionState: exec.providerState, arcTxHash: exec.txHash, arcStatus: exec.status } : null,
    });
  } catch (e) {
    return NextResponse.json({ database: "neon-postgres", error: (e as Error).message, signer }, { status: 500 });
  }
}
