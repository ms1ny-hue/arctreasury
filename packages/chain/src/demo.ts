import { hashValue, money, type Money } from "@arctreasury/domain";
import { ARC_TESTNET } from "@arctreasury/config";
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

/**
 * Deterministic in-memory gateway. No network, no keys, no real transactions.
 * Every value is reproducible from the inputs so demos and tests are stable.
 * `status().mode` is always "demo" and everything is labelled as such — it can
 * never be mistaken for the live Arc Testnet path.
 */
export class DemoGateway implements ChainGateway {
  private block = 8_000_000;
  constructor(private readonly balances: Record<string, Money> = {}) {}

  async status(): Promise<NetworkStatus> {
    return {
      mode: "demo",
      chainId: ARC_TESTNET.chainId,
      blockNumber: this.block,
      connected: true,
      label: "DEMO — deterministic simulator, no real transactions",
    };
  }

  async getBalance(address: Address): Promise<Money> {
    return this.balances[address.toLowerCase()] ?? money(0n);
  }

  async simulateProposal(input: ApprovedExecutionInput): Promise<SimulationResult> {
    const simulationHash = hashValue({ sim: "demo", input }) as Hash;
    if (input.amount.amount <= 0n) {
      return { ok: false, reason: "non-positive amount", simulationHash };
    }
    return { ok: true, simulationHash, gasEstimate: 55_000n };
  }

  async submitApprovedProposal(input: ApprovedExecutionInput): Promise<SubmittedTx> {
    // Deterministic pseudo-hash derived from the proposal; clearly a demo value.
    const txHash = (hashValue({ demoTx: input.proposalId, amount: input.amount }).slice(0, 66)) as Hash;
    return { txHash, submittedAt: this.nowSeed(input.proposalId) };
  }

  async waitForReceipt(hash: Hash): Promise<ExecutionReceipt> {
    this.block += 1;
    return {
      txHash: hash,
      blockNumber: this.block,
      status: "success",
      explorerUrl: `${ARC_TESTNET.explorerUrl}/tx/${hash}  (DEMO — not a real on-chain tx)`,
      confirmedAt: this.block,
    };
  }

  private nowSeed(id: string): number {
    // stable pseudo-timestamp from the id, no wall clock
    let acc = 0;
    for (const ch of id) acc = (acc + ch.charCodeAt(0)) % 100000;
    return 1_784_898_000 + acc;
  }
}
