import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashValue, money, type Money } from "@arctreasury/domain";
import { ARC_TESTNET } from "@arctreasury/config";
import { ERC20_ABI, EXECUTOR_ABI } from "./abi.js";
import type {
  Address,
  ApprovedExecutionInput,
  ChainGateway,
  ExecutionReceipt,
  Hash,
  NetworkStatus,
  SimulationResult,
  SubmittedTx,
} from "./gateway.js";

/** viem chain built from our verified Arc Testnet constants. */
export const arcTestnetChain = defineChain({
  id: ARC_TESTNET.chainId,
  name: ARC_TESTNET.name,
  nativeCurrency: ARC_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [ARC_TESTNET.rpcUrls.primary] } },
  blockExplorers: { default: { name: "Arcscan", url: ARC_TESTNET.explorerUrl } },
  testnet: true,
});

export interface ArcGatewayConfig {
  rpcUrl?: string;
  usdcAddress?: Address;
  executorAddress?: Address;
  /** Server-side only. Testnet key with no real value. Omit for read-only. */
  privateKey?: `0x${string}`;
}

/**
 * Real Arc Testnet gateway. Reads (balance, block, simulate) work with no
 * credentials. Writes require a deployed executor and a testnet signer supplied
 * out-of-band; without them, write calls fail loudly rather than pretending.
 */
export class ArcTestnetGateway implements ChainGateway {
  private readonly pub: PublicClient;
  private readonly wallet?: WalletClient;
  private readonly usdc: Address;
  private readonly executor?: Address;

  constructor(cfg: ArcGatewayConfig = {}) {
    // Blockdaemon endpoint by default: the primary rate-limits several parallel
    // contract reads per request (the dashboard does exactly that).
    const rpc = cfg.rpcUrl ?? ARC_TESTNET.rpcUrls.blockdaemon;
    this.pub = createPublicClient({ chain: arcTestnetChain, transport: http(rpc) });
    this.usdc = (cfg.usdcAddress ?? (ARC_TESTNET.contracts.usdc as Address));
    if (cfg.executorAddress) this.executor = cfg.executorAddress;
    if (cfg.privateKey) {
      const account = privateKeyToAccount(cfg.privateKey);
      this.wallet = createWalletClient({ account, chain: arcTestnetChain, transport: http(rpc) });
    }
  }

  async status(): Promise<NetworkStatus> {
    try {
      const bn = await this.pub.getBlockNumber();
      return {
        mode: "arc-testnet",
        chainId: ARC_TESTNET.chainId,
        blockNumber: Number(bn),
        connected: true,
        label: "ARC TESTNET — live reads",
      };
    } catch {
      return { mode: "arc-testnet", chainId: ARC_TESTNET.chainId, blockNumber: null, connected: false, label: "ARC TESTNET — RPC unreachable" };
    }
  }

  async getBalance(address: Address): Promise<Money> {
    // NOTE: Arc's USDC precompile (0x3600...) implements balanceOf but NOT the
    // standard decimals()/symbol() (they revert). Verified on Arc Testnet:
    // balanceOf returns 6-decimal units, matching this domain's USDC scale, so
    // no rescaling is needed. We do not call decimals().
    const raw = await this.pub.readContract({
      address: this.usdc,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    });
    return money(raw as bigint, "USDC", 6);
  }

  async simulateProposal(input: ApprovedExecutionInput): Promise<SimulationResult> {
    const simulationHash = hashValue({ sim: "arc", input }) as Hash;
    if (!this.executor) {
      return { ok: false, reason: "no executor address configured", simulationHash };
    }
    try {
      await this.pub.simulateContract({
        address: this.executor,
        abi: EXECUTOR_ABI,
        functionName: "executeProposal",
        args: [input.proposalId],
        ...(this.wallet?.account ? { account: this.wallet.account } : {}),
      });
      return { ok: true, simulationHash };
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0] ?? "simulation reverted";
      return { ok: false, reason, simulationHash };
    }
  }

  async submitApprovedProposal(input: ApprovedExecutionInput): Promise<SubmittedTx> {
    if (!this.wallet || !this.wallet.account) throw new Error("No signer configured: set a testnet DEPLOYER_PRIVATE_KEY to submit transactions.");
    if (!this.executor) throw new Error("No executor address configured.");
    const txHash = (await this.wallet.writeContract({
      address: this.executor,
      abi: EXECUTOR_ABI,
      functionName: "executeProposal",
      args: [input.proposalId],
      account: this.wallet.account,
      chain: arcTestnetChain,
    })) as Hash;
    return { txHash, submittedAt: Math.floor(Date.now() / 1000) };
  }

  async waitForReceipt(hash: Hash): Promise<ExecutionReceipt> {
    const r = await this.pub.waitForTransactionReceipt({ hash });
    return {
      txHash: hash,
      blockNumber: Number(r.blockNumber),
      status: r.status === "success" ? "success" : "reverted",
      explorerUrl: `${ARC_TESTNET.explorerUrl}/tx/${hash}`,
      confirmedAt: Math.floor(Date.now() / 1000),
    };
  }

  /** Live-read the deployed executor's on-chain state for a proposal id. */
  async readExecutorState(executor: Address, proposalId: Hash): Promise<{
    isExecuted: boolean;
    certificateCommitment: string;
    maxSingleAmount: bigint;
    proposal: { token: string; destination: string; amount: bigint; approved: boolean; executed: boolean; exists: boolean };
  }> {
    const [isExecuted, certificateCommitment, maxSingleAmount, proposal] = await Promise.all([
      this.pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "isExecuted", args: [proposalId] }),
      this.pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "certificateCommitmentOf", args: [proposalId] }),
      this.pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "maxSingleAmount", args: [] }),
      this.pub.readContract({ address: executor, abi: EXECUTOR_ABI, functionName: "getProposal", args: [proposalId] }),
    ]);
    const p = proposal as { token: string; destination: string; amount: bigint; approved: boolean; executed: boolean; exists: boolean };
    return {
      isExecuted: isExecuted as boolean,
      certificateCommitment: certificateCommitment as string,
      maxSingleAmount: maxSingleAmount as bigint,
      proposal: { token: p.token, destination: p.destination, amount: p.amount, approved: p.approved, executed: p.executed, exists: p.exists },
    };
  }

  /** Live-read a confirmed transaction receipt (status + block + log count). */
  async getReceiptState(hash: Hash): Promise<{ status: string; blockNumber: number; logs: number } | null> {
    try {
      const r = await this.pub.getTransactionReceipt({ hash });
      return { status: r.status === "success" ? "success" : "reverted", blockNumber: Number(r.blockNumber), logs: r.logs.length };
    } catch {
      return null;
    }
  }
}
