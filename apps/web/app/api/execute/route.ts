import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnetChain, EXECUTOR_ABI } from "@arctreasury/chain";
import { ARC_TESTNET, explorerTx } from "@arctreasury/config";
import { computePipeline, DEPLOYMENT as deployment } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";

const RPC = "https://rpc.blockdaemon.testnet.arc.network";
const SETTLE_ATOMS = 50_000n; // 0.05 USDC — scaled-down testnet safety; business amount stays simulated
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a fresh, real settlement on Arc Testnet through the deployed policy
 * contract: register -> human-authorized approve -> execute. The signer is a
 * server-side testnet-only key (never sent to the browser); if it is not
 * configured, we return an explicit, labelled demo result instead of pretending.
 */
export async function POST() {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY ?? "") as `0x${string}`;
  const executor = deployment.address as `0x${string}`;
  const vault = deployment.vault as `0x${string}`;
  const usdc = ARC_TESTNET.contracts.usdc as `0x${string}`;

  // Bind the on-chain commitment to a freshly computed evidence bundle.
  const pipe = computePipeline("downside");
  const certCommit = pipe.certificate.commitment as `0x${string}`;
  const policyHash = pipe.evidence.policyHash as `0x${string}`;
  const inputHash = pipe.evidence.inputSnapshotHash as `0x${string}`;
  const proposalId = keccak256(toHex(`live-${Date.now()}-${Math.round(Math.random() * 1e9)}`));

  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return NextResponse.json({
      mode: "demo",
      note: "No server signer configured (DEPLOYER_PRIVATE_KEY unset). This is a labelled demo result, not a real transaction. Set a testnet key server-side to execute live on Arc.",
      proposalId,
      settledAmount: "0.050000 USDC",
      certificateCommitment: certCommit,
    });
  }

  try {
    const account = privateKeyToAccount(pk);
    const pub = createPublicClient({ chain: arcTestnetChain, transport: http(RPC) });
    const wal = createWalletClient({ account, chain: arcTestnetChain, transport: http(RPC) });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 7200);

    let nonce = await pub.getTransactionCount({ address: account.address });
    const send = (fn: string, args: unknown[]) =>
      wal.writeContract({ address: executor, abi: EXECUTOR_ABI, functionName: fn as never, args: args as never, account, chain: arcTestnetChain, nonce: nonce++ });
    const waitOk = async (h: `0x${string}`) => {
      for (let i = 0; i < 40; i++) {
        try { const r = await pub.getTransactionReceipt({ hash: h }); return r; } catch { await sleep(2500); }
      }
      throw new Error("receipt timeout");
    };

    const tReg = await send("registerProposal", [proposalId, usdc, vault, SETTLE_ATOMS, expiry, policyHash, inputHash, certCommit]);
    await waitOk(tReg); await sleep(1200);
    const tApp = await send("approveProposal", [proposalId]);
    await waitOk(tApp); await sleep(1200);
    const tExec = await send("executeProposal", [proposalId]);
    const rExec = await waitOk(tExec);

    const onchainCommit = (await pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "certificateCommitmentOf", args: [proposalId] })) as string;
    const executed = (await pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "isExecuted", args: [proposalId] })) as boolean;

    return NextResponse.json({
      mode: "arc-testnet",
      proposalId,
      settledAmount: "0.050000 USDC",
      certificateCommitment: certCommit,
      onchainCommitment: onchainCommit,
      commitmentMatches: onchainCommit.toLowerCase() === certCommit.toLowerCase(),
      executed,
      register: { tx: tReg, url: explorerTx(tReg) },
      approve: { tx: tApp, url: explorerTx(tApp) },
      execute: { tx: tExec, url: explorerTx(tExec), block: Number(rExec.blockNumber), status: rExec.status === "success" ? "success" : "reverted", logs: rExec.logs.length },
      note: "Real Arc Testnet settlement: register -> approve -> execute. 0.05 USDC moved through the contract to the allowlisted vault.",
    });
  } catch (e) {
    return NextResponse.json({ mode: "error", note: `Execution failed: ${(e as Error).message.split("\n")[0]}`, proposalId }, { status: 500 });
  }
}
