import { createPublicClient, http, webSocket, parseAbiItem, type Log } from "viem";
import { arcTestnetChain, EXECUTOR_ABI } from "@arctreasury/chain";
import { ARC_TESTNET } from "@arctreasury/config";
import { Store, type ReconStatus } from "./store.js";
import deployment from "../../../packages/contracts/deployments/arc-testnet.json" with { type: "json" };

const HTTP_RPC = "https://rpc.blockdaemon.testnet.arc.network";
const WS_RPC = "wss://rpc.blockdaemon.testnet.arc.network";
const CHAIN_ID = ARC_TESTNET.chainId;
const EXECUTOR = deployment.address as `0x${string}`;

const EV = {
  registered: parseAbiItem("event ProposalRegistered(bytes32 indexed proposalId, address indexed token, address indexed destination, uint256 amount, uint64 expiry, bytes32 certificateCommitment)"),
  approved: parseAbiItem("event ProposalApproved(bytes32 indexed proposalId, address indexed approver)"),
  executed: parseAbiItem("event ProposalExecuted(bytes32 indexed proposalId, address indexed destination, uint256 amount)"),
};

export class Indexer {
  private http = createPublicClient({ chain: arcTestnetChain, transport: http(HTTP_RPC) });
  constructor(private store: Store, private log: (s: string) => void = console.log) {}

  private async deployBlock(): Promise<number> {
    try {
      const r = await this.http.getTransactionReceipt({ hash: deployment.transactions.deploy as `0x${string}` });
      return Number(r.blockNumber);
    } catch { return Number(await this.http.getBlockNumber()) - 2000; }
  }

  /** Backfill executor events from the cursor (or deploy block) to head, chunked. */
  async backfill(): Promise<void> {
    const cur = this.store.getCursor(CHAIN_ID);
    const from = cur ? cur.lastBlock + 1 : await this.deployBlock();
    const head = Number(await this.http.getBlockNumber());
    if (from > head) { this.log(`backfill: up to date at ${head}`); return; }
    this.log(`backfill: blocks ${from} → ${head}`);
    const CHUNK = 4000;
    for (let start = from; start <= head; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, head);
      for (const [name, event] of Object.entries(EV)) {
        const logs = await this.http.getLogs({ address: EXECUTOR, event: event as any, fromBlock: BigInt(start), toBlock: BigInt(end) });
        for (const lg of logs) await this.ingestLog(name, lg);
      }
    }
    const headBlock = await this.http.getBlock({ blockNumber: BigInt(head) });
    this.store.setCursor(CHAIN_ID, head, headBlock.hash);
    this.log(`backfill: cursor at ${head}`);
  }

  private async ingestLog(name: string, lg: Log): Promise<void> {
    const args = (lg as unknown as { args: Record<string, unknown> }).args ?? {};
    const proposalId = String(args.proposalId ?? "");
    const blockHash = lg.blockHash ?? "0x";
    // reorg guard: if this block's hash changed, drop stale rows for it first
    this.store.purgeBlock(CHAIN_ID, Number(lg.blockNumber), blockHash);
    const inserted = this.store.putEvent({
      chainId: CHAIN_ID,
      txHash: lg.transactionHash ?? "0x",
      logIndex: lg.logIndex ?? 0,
      blockNumber: Number(lg.blockNumber),
      blockHash,
      eventName: name,
      proposalId,
      destination: args.destination ? String(args.destination) : null,
      amount: args.amount !== undefined ? String(args.amount) : null,
      sourceSystem: "arc-testnet-rpc",
      observedAt: Date.now(),
      ingestedAt: Date.now(),
      classification: "live",
    });
    if (inserted && name === "executed") {
      this.log(`event executed: proposal ${proposalId.slice(0, 14)}… tx ${(lg.transactionHash ?? "").slice(0, 14)}…`);
      await this.reconcile(proposalId);
    }
  }

  /**
   * Reconcile an executed proposal: an execution is "matched" only when the
   * confirmed ProposalExecuted event agrees with the contract's stored proposal
   * (destination + amount + executed flag + a set certificate commitment).
   * Submitting a tx is never sufficient — this reads on-chain truth.
   */
  async reconcile(pid: string): Promise<ReconStatus> {
    try {
      const [proposal, executed, commitment] = await Promise.all([
        this.http.readContract({ address: EXECUTOR, abi: EXECUTOR_ABI, functionName: "getProposal", args: [pid as `0x${string}`] }),
        this.http.readContract({ address: EXECUTOR, abi: EXECUTOR_ABI, functionName: "isExecuted", args: [pid as `0x${string}`] }),
        this.http.readContract({ address: EXECUTOR, abi: EXECUTOR_ABI, functionName: "certificateCommitmentOf", args: [pid as `0x${string}`] }),
      ]);
      const p = proposal as { destination: string; amount: bigint; executed: boolean; exists: boolean };
      const ev = this.store.eventsForProposal(pid).find((e) => e.eventName === "executed");
      const commitmentSet = String(commitment) !== "0x0000000000000000000000000000000000000000000000000000000000000000";

      let status: ReconStatus; let detail: string;
      if (!p.exists) { status = "failed"; detail = "no such proposal on-chain"; }
      else if (!executed || !p.executed) { status = "pending"; detail = "not yet executed on-chain"; }
      else if (!ev) { status = "pending"; detail = "executed but no confirmed event indexed yet"; }
      else if (ev.destination?.toLowerCase() !== p.destination.toLowerCase() || ev.amount !== p.amount.toString()) {
        status = "mismatched"; detail = `event (${ev.destination}, ${ev.amount}) != storage (${p.destination}, ${p.amount})`;
      } else if (!commitmentSet) { status = "mismatched"; detail = "executed but no certificate commitment stored"; }
      else { status = "matched"; detail = `dest+amount+executed+commitment agree; tx ${ev.txHash}`; }

      this.store.putReconciliation(pid, status, detail, ev?.txHash ?? null, String(commitment), Boolean(executed));
      if (ev?.txHash) {
        const r = await this.http.getTransactionReceipt({ hash: ev.txHash as `0x${string}` }).catch(() => null);
        if (r) { const head = Number(await this.http.getBlockNumber()); this.store.putArcTx(ev.txHash, Number(r.blockNumber), r.status === "success" ? "success" : "reverted", head - Number(r.blockNumber)); }
      }
      this.log(`reconcile ${pid.slice(0, 14)}… → ${status.toUpperCase()}`);
      return status;
    } catch (e) {
      this.store.putReconciliation(pid, "failed", (e as Error).message.split("\n")[0] ?? "error", null, null, null);
      return "failed";
    }
  }

  /** Live subscribe via WebSocket; advance cursor per block, reorg-aware. */
  async watch(): Promise<() => void> {
    const wsClient = createPublicClient({ chain: arcTestnetChain, transport: webSocket(WS_RPC) });
    const unwatchEvents = wsClient.watchContractEvent({
      address: EXECUTOR,
      abi: EXECUTOR_ABI,
      onLogs: async (logs) => { for (const lg of logs) { const n = String((lg as { eventName?: string }).eventName ?? ""); await this.ingestLog(mapName(n), lg); } },
      onError: (e) => this.log(`ws event error: ${e.message.split("\n")[0]}`),
    });
    const unwatchBlocks = wsClient.watchBlocks({
      onBlock: (b) => { this.store.setCursor(CHAIN_ID, Number(b.number), b.hash ?? "0x"); },
      onError: (e) => this.log(`ws block error: ${e.message.split("\n")[0]}`),
    });
    this.log("watching Arc Testnet over WebSocket…");
    return () => { unwatchEvents(); unwatchBlocks(); };
  }
}

function mapName(eventName: string): string {
  if (eventName === "ProposalExecuted") return "executed";
  if (eventName === "ProposalApproved") return "approved";
  if (eventName === "ProposalRegistered") return "registered";
  return eventName;
}
