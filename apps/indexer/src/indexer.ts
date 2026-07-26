import { createPublicClient, http, webSocket, parseAbiItem, type Log } from "viem";
import { arcTestnetChain, EXECUTOR_ABI } from "@arctreasury/chain";
import { ARC_TESTNET } from "@arctreasury/config";
import * as db from "@arctreasury/db";
import deployment from "../../../packages/contracts/deployments/arc-testnet.json" with { type: "json" };

const HTTP_RPC = "https://rpc.blockdaemon.testnet.arc.network";
const WS_RPC = "wss://rpc.blockdaemon.testnet.arc.network";
const CHAIN_ID = ARC_TESTNET.chainId;
const EXECUTOR = deployment.address as `0x${string}`;
const CONFIRM_DEPTH = Number(process.env.CONFIRM_DEPTH ?? 5); // finality threshold before "matched"
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;

const EV = {
  registered: parseAbiItem("event ProposalRegistered(bytes32 indexed proposalId, address indexed token, address indexed destination, uint256 amount, uint64 expiry, bytes32 certificateCommitment)"),
  approved: parseAbiItem("event ProposalApproved(bytes32 indexed proposalId, address indexed approver)"),
  executed: parseAbiItem("event ProposalExecuted(bytes32 indexed proposalId, address indexed destination, uint256 amount)"),
};

/** Persists to the shared Neon Postgres (same DB as the web app + MCP). */
export class Indexer {
  private http = createPublicClient({ chain: arcTestnetChain, transport: http(HTTP_RPC) });
  constructor(private log: (s: string) => void = console.log) {}

  private async deployBlock(): Promise<number> {
    try { return Number((await this.http.getTransactionReceipt({ hash: deployment.transactions.deploy as `0x${string}` })).blockNumber); }
    catch { return Number(await this.http.getBlockNumber()) - 2000; }
  }

  async backfill(): Promise<number> {
    const cur = await db.getCursor(CHAIN_ID);
    const from = cur ? cur.lastBlock + 1 : await this.deployBlock();
    const head = Number(await this.http.getBlockNumber());
    if (from <= head) {
      this.log(`backfill: blocks ${from} → ${head}`);
      const CHUNK = 4000;
      for (let start = from; start <= head; start += CHUNK) {
        const end = Math.min(start + CHUNK - 1, head);
        for (const [name, event] of Object.entries(EV)) {
          const logs = await this.http.getLogs({ address: EXECUTOR, event: event as never, fromBlock: BigInt(start), toBlock: BigInt(end) });
          for (const lg of logs) await this.ingestLog(name, lg, head);
        }
      }
      const hb = await this.http.getBlock({ blockNumber: BigInt(head) });
      await db.setCursor(CHAIN_ID, head, hb.hash);
    }
    await db.heartbeat(WORKER_ID, head);
    return head;
  }

  private async ingestLog(name: string, lg: Log, head: number): Promise<void> {
    const args = (lg as unknown as { args: Record<string, unknown> }).args ?? {};
    const proposalId = String(args.proposalId ?? "");
    const blockHash = lg.blockHash ?? "0x";
    await db.purgeBlock(CHAIN_ID, Number(lg.blockNumber), blockHash);
    const inserted = await db.putEvent({
      chainId: CHAIN_ID, txHash: lg.transactionHash ?? "0x", logIndex: lg.logIndex ?? 0,
      blockNumber: Number(lg.blockNumber), blockHash, eventName: name, proposalId,
      destination: args.destination ? String(args.destination) : null,
      amount: args.amount !== undefined ? String(args.amount) : null,
      sourceSystem: "arc-testnet-rpc", observedAt: Date.now(), ingestedAt: Date.now(), classification: "live",
    });
    if (inserted && name === "executed") { this.log(`event executed: ${proposalId.slice(0, 14)}…`); await this.reconcile(proposalId, head); }
  }

  /**
   * Reconcile with explicit finality. States: submitted→mined→confirmed→finalized.
   * Only reaches "matched" once the confirmed event agrees with contract storage
   * AND has CONFIRM_DEPTH confirmations. Submitting a tx is never sufficient.
   */
  async reconcile(pid: string, head?: number): Promise<string> {
    try {
      const h = head ?? Number(await this.http.getBlockNumber());
      const [proposal, executed, commitment] = await Promise.all([
        this.http.readContract({ address: EXECUTOR, abi: EXECUTOR_ABI, functionName: "getProposal", args: [pid as `0x${string}`] }),
        this.http.readContract({ address: EXECUTOR, abi: EXECUTOR_ABI, functionName: "isExecuted", args: [pid as `0x${string}`] }),
        this.http.readContract({ address: EXECUTOR, abi: EXECUTOR_ABI, functionName: "certificateCommitmentOf", args: [pid as `0x${string}`] }),
      ]);
      const p = proposal as { destination: string; amount: bigint; executed: boolean; exists: boolean };
      const ev = (await db.eventsForProposal(pid)).find((e) => e.eventName === "executed");
      const commitmentSet = String(commitment) !== "0x" + "0".repeat(64);
      const confirmations = ev ? h - ev.blockNumber : 0;

      let status: string; let detail: string; let finality: string;
      if (!p.exists) { status = "failed"; detail = "no such proposal on-chain"; finality = "failed"; }
      else if (!executed) { status = "pending"; detail = "not executed on-chain"; finality = "submitted"; }
      else if (!ev) { status = "pending"; detail = "executed; awaiting indexed event"; finality = "mined"; }
      else if (ev.destination?.toLowerCase() !== p.destination.toLowerCase() || ev.amount !== p.amount.toString()) { status = "mismatched"; detail = `event≠storage`; finality = "mined"; }
      else if (!commitmentSet) { status = "mismatched"; detail = "no certificate commitment"; finality = "mined"; }
      else if (confirmations < CONFIRM_DEPTH) { status = "pending"; detail = `confirmed but ${confirmations}/${CONFIRM_DEPTH} confirmations`; finality = "confirmed"; }
      else { status = "matched"; detail = `agree @ ${confirmations} confs; tx ${ev.txHash}`; finality = "finalized"; }

      await db.upsertReconciliation(pid, status, detail, ev?.txHash ?? null, String(commitment), Boolean(executed), confirmations, finality);
      if (ev?.txHash) { const r = await this.http.getTransactionReceipt({ hash: ev.txHash as `0x${string}` }).catch(() => null); if (r) await db.putArcTx?.(ev.txHash, Number(r.blockNumber), r.status === "success" ? "success" : "reverted", confirmations); }
      this.log(`reconcile ${pid.slice(0, 14)}… → ${status.toUpperCase()} (${finality})`);
      return status;
    } catch (e) {
      await db.upsertReconciliation(pid, "failed", (e as Error).message.split("\n")[0] ?? "error", null, null, null, 0, "failed");
      return "failed";
    }
  }

  async watch(): Promise<() => void> {
    const ws = createPublicClient({ chain: arcTestnetChain, transport: webSocket(WS_RPC) });
    const un1 = ws.watchContractEvent({ address: EXECUTOR, abi: EXECUTOR_ABI, onLogs: async (logs) => { const head = Number(await this.http.getBlockNumber()); for (const lg of logs) await this.ingestLog(mapName(String((lg as { eventName?: string }).eventName ?? "")), lg, head); }, onError: (e) => this.log(`ws event error: ${e.message.split("\n")[0]}`) });
    const un2 = ws.watchBlocks({ onBlock: async (b) => { await db.setCursor(CHAIN_ID, Number(b.number), b.hash ?? "0x"); await db.heartbeat(WORKER_ID, Number(b.number)); }, onError: (e) => this.log(`ws block error: ${e.message.split("\n")[0]}`) });
    this.log("watching Arc Testnet over WebSocket…");
    return () => { un1(); un2(); };
  }
}

function mapName(n: string): string { return n === "ProposalExecuted" ? "executed" : n === "ProposalApproved" ? "approved" : n === "ProposalRegistered" ? "registered" : n; }
