import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { arcTestnetChain, EXECUTOR_ABI } from "@arctreasury/chain";
import { recomputeEvidenceCommitment, DEPLOYMENT as deployment } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";
const RPC = "https://rpc.blockdaemon.testnet.arc.network";

/**
 * Independently verify an evidence bundle: recompute its integrity commitment,
 * and (if a proposalId is given) read the deployed contract's stored commitment
 * from Arc. States plainly what this does and does not establish.
 */
export async function POST(req: Request) {
  let body: { evidence?: Record<string, unknown>; proposalId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.evidence || typeof body.evidence !== "object") return NextResponse.json({ error: "missing evidence bundle" }, { status: 400 });

  const integrity = recomputeEvidenceCommitment(body.evidence);

  let onchain: { commitment: string; matchesBundle: boolean } | null = null;
  const pid = body.proposalId;
  if (pid && /^0x[0-9a-fA-F]{64}$/.test(pid)) {
    try {
      const pub = createPublicClient({ chain: arcTestnetChain, transport: http(RPC) });
      const c = (await pub.readContract({ address: deployment.address as `0x${string}`, abi: EXECUTOR_ABI, functionName: "certificateCommitmentOf", args: [pid as `0x${string}`] })) as string;
      const attest = (body.evidence as { attestationCommitment?: string }).attestationCommitment ?? "";
      onchain = { commitment: c, matchesBundle: c.toLowerCase() === attest.toLowerCase() };
    } catch { onchain = null; }
  }

  return NextResponse.json({
    integrity: { recomputed: integrity.recomputed, matches: integrity.matches },
    onchain,
    establishes: "Tamper-evidence: the bundle is unchanged since its commitment, and (with a proposalId) the contract holds the same attestation commitment on Arc.",
    doesNotEstablish: "The truth of the private balances, obligations, or the coverage calculation. Those are verified deterministically off-chain by the independent verifier.",
  });
}
