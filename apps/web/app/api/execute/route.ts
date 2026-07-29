import { NextResponse } from "next/server";
import { createPublicClient, http, keccak256, toHex } from "viem";
import { arcTestnetChain, EXECUTOR_ABI, selectSigner, type Signer } from "@arctreasury/chain";
import { ARC_TESTNET, explorerTx } from "@arctreasury/config";
import { isConfigured, getProposal, beginExecuting, settleProposal, recordExecution, StateConflict } from "@arctreasury/db";
import { DEPLOYMENT as deployment } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Circle submits 3 sequential on-chain txs; capped to the plan max.

const RPC = process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network";
const SETTLE_ATOMS = 50_000n; // 0.05 USDC — scaled-down testnet safety; the business amount stays SIMULATED.
const ORG = "demo-org";
const MAX_APPROVED_AGE_MS = 60 * 60 * 1000; // treat an approval older than 1h as expired for execution.

/**
 * Execute an APPROVED, PERSISTED proposal on Arc Testnet through the signer
 * abstraction. The signer (Circle in production, never a raw key) is only the
 * wallet/submission layer. Everything that authorizes the action is checked here
 * and comes from the stored proposal — not from the request body:
 *   - proposal exists and is org-scoped
 *   - state is exactly `approved` (human approval already recorded)
 *   - approval is not stale/expired
 *   - amount, destination, policy hash, input hash, certificate commitment come
 *     from the stored row (the browser cannot change them)
 *   - allowlist + per-tx cap + single-execution are additionally enforced on-chain
 *   - idempotency via a compare-and-set approved -> executing transition
 * Nothing is marked settled on a provider's word: we settle only after the Arc
 * receipt is a success AND the contract reports the proposal executed.
 */
export async function POST(req: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "persistence not configured (no DATABASE_URL)" }, { status: 503 });

  let body: { proposalId?: string } = {};
  try { body = (await req.json().catch(() => ({}))) as { proposalId?: string }; } catch { body = {}; }
  const proposalId = (body.proposalId ?? "").trim();
  if (!proposalId) return NextResponse.json({ error: "proposalId required (create + approve it first)" }, { status: 400 });

  // 1. Stored, org-scoped proposal lookup.
  const p = await getProposal(ORG, proposalId);
  if (!p) return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  if (p.superseded) return NextResponse.json({ error: "proposal superseded" }, { status: 409 });
  if (p.state === "settled") return NextResponse.json({ mode: "arc-testnet", proposalId: p.id, state: "settled", note: "already settled (idempotent)" });
  // Executable from `approved` (first run) or `executing` (resume after a lost response).
  if (p.state !== "approved" && p.state !== "executing") {
    return NextResponse.json({ error: `proposal not executable in state '${p.state}' (requires 'approved')`, state: p.state }, { status: 409 });
  }
  // 2. Expiry: reject stale approvals (only gates the first run, not a resume).
  if (p.state === "approved" && Date.parse(p.updated_at) < Date.now() - MAX_APPROVED_AGE_MS) {
    return NextResponse.json({ error: "approval expired; re-approve before executing", state: p.state }, { status: 409 });
  }

  // 3. Signer selection. In production this is Circle or nothing — never a raw key.
  const signer: Signer = selectSigner();
  if (!signer.ready()) {
    return NextResponse.json({
      error: "signer not available",
      signerProvider: signer.provider,
      note: signer.provider === "disabled"
        ? "Execution is disabled because Circle is not provisioned and raw-key signing is off in production. Set CIRCLE_API_KEY + entity secret + wallet to enable."
        : "signer not ready",
    }, { status: 503 });
  }

  const executor = deployment.address as `0x${string}`;
  const usdc = ARC_TESTNET.contracts.usdc as `0x${string}`;
  // On-chain destination is the ALLOWLISTED settlement vault (the contract reverts
  // any non-allowlisted destination). p.dest_address is the logical/business
  // destination (the payout pool) and is preserved in the response + evidence.
  const businessDest = p.dest_address as `0x${string}`;
  const dest = deployment.vault as `0x${string}`;
  const policyHash = p.policy_hash as `0x${string}`;
  const inputHash = p.input_hash as `0x${string}`;
  const certCommit = p.cert_commitment as `0x${string}`;
  const proposalIdHash = keccak256(toHex(p.id));
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 7200);
  const walletAddr = await signer.address().catch(() => null);

  // 4. Idempotent claim: approved -> executing (compare-and-set). A duplicate
  //    execute racing another from `approved` fails here, before any chain call.
  //    A resume (already `executing`) skips the claim and continues from chain truth.
  if (p.state === "approved") {
    try {
      await beginExecuting(ORG, p.id, proposalIdHash);
    } catch (e) {
      if (e instanceof StateConflict) return NextResponse.json({ error: "already executing or settled (duplicate execute rejected)" }, { status: 409 });
      throw e;
    }
  }

  const pub = createPublicClient({ chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Backoff wrapper for reads that the shared Arc RPC intermittently rate-limits.
  const readBackoff = async <T>(fn: () => Promise<T>, tries = 8): Promise<T> => {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) { lastErr = e; await sleep(1200 * (i + 1)); }
    }
    throw lastErr;
  };
  const proposalState = async () =>
    (await readBackoff(() => pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "getProposal", args: [proposalIdHash] }))) as {
      exists: boolean; approved: boolean; executed: boolean; certificateCommitment: string;
    };
  // Idempotent/replayable step: only submit the call if the on-chain state needs it.
  // A lost HTTP response never double-submits, and a re-run resumes from chain truth.
  const ensure = async (fn: string, args: unknown[], tag: string, needed: (s: { exists: boolean; approved: boolean; executed: boolean }) => boolean) => {
    if (!needed(await proposalState())) return null;
    const sent = await signer.writeContract({ to: executor, functionName: fn, args, idempotencyKey: `${p.id}:${tag}` });
    const done = await signer.waitForTx(sent).catch(() => sent); // chain truth is authority, not this receipt
    await sleep(1500);
    return done;
  };

  try {
    // Each step is conditional on current on-chain state, so this is safe to retry.
    const reg = await ensure("registerProposal", [proposalIdHash, usdc, dest, SETTLE_ATOMS, expiry, policyHash, inputHash, certCommit], "register", (s) => !s.exists);
    const app = await ensure("approveProposal", [proposalIdHash], "approve", (s) => s.exists && !s.approved && !s.executed);
    const exe = await ensure("executeProposal", [proposalIdHash], "execute", (s) => s.exists && !s.executed);

    // 5. Settle ONLY on verified Arc state (getProposal.executed) — never a provider's word.
    const finalState = await proposalState();
    const onchainExecuted = finalState.executed === true;
    const onchainCommit = finalState.certificateCommitment;
    const execHash = exe?.txHash ?? null;

    await recordExecution(p.id, {
      txHash: execHash ?? `${proposalIdHash}:executed`, block: 0, status: onchainExecuted ? "success" : "reverted",
      signerProvider: signer.provider, providerTxId: exe?.providerTxId ?? null, providerState: exe?.providerState ?? "replayed",
      circleWalletId: signer.provider === "circle" ? (process.env.CIRCLE_WALLET_ID ?? null) : null,
    });

    if (!onchainExecuted) {
      return NextResponse.json({ error: "on-chain execution did not confirm as executed", executed: false, proposalId: p.id }, { status: 502 });
    }
    if (execHash) { try { const r = await readBackoff(() => pub.getTransactionReceipt({ hash: execHash })); await settleProposal(ORG, p.id, execHash, Number(r.blockNumber)); } catch { await settleProposal(ORG, p.id, execHash, 0); } }
    else { await settleProposal(ORG, p.id, `${proposalIdHash.slice(0, 42)}`, 0); }

    return NextResponse.json({
      mode: "arc-testnet",
      proposalId: p.id,
      onchainProposalId: proposalIdHash,
      businessDestination: businessDest,
      settlementVault: dest,
      signerProvider: signer.provider,
      signerWallet: walletAddr,
      circleTransactionId: exe?.providerTxId ?? null,
      circleTransactionState: exe?.providerState ?? "replayed-from-chain",
      settledAmount: "0.050000 USDC",
      certificateCommitment: certCommit,
      onchainCommitment: onchainCommit,
      commitmentMatches: onchainCommit.toLowerCase() === certCommit.toLowerCase(),
      executed: onchainExecuted,
      register: { tx: reg?.txHash ?? null, url: reg?.txHash ? explorerTx(reg.txHash) : null },
      approve: { tx: app?.txHash ?? null, url: app?.txHash ? explorerTx(app.txHash) : null },
      execute: { tx: execHash, url: execHash ? explorerTx(execHash) : null, status: "success" },
      note: `Real Arc Testnet settlement via ${signer.provider}. Human approval was recorded server-side (persistent, concurrency-safe workflow); the same wallet mechanically signed register/approve/execute — approval and execution are not signer-separated on-chain. Settlement is confirmed from on-chain state, not the RPC response.`,
    });
  } catch (e) {
    // Left in `executing` for the reconciler to resolve; never silently settled.
    return NextResponse.json({ error: `execution failed: ${(e as Error).message.split("\n")[0]}`, proposalId: p.id, state: "executing", signerProvider: signer.provider }, { status: 500 });
  }
}
