import type { Money } from "@arctreasury/domain";

/**
 * ChainGateway — the single execution-rail abstraction. Arc is ONE rail behind
 * this interface, so the commercial decision engine stays rail-neutral while
 * Arc is the complete live path. `DemoGateway` and `ArcTestnetGateway` both
 * implement it; demo mode can never be confused with the real testnet path.
 */
export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export interface ExecutionInput {
  proposalId: Hash;
  token: Address;
  destination: Address;
  amount: Money;
}
export interface ApprovedExecutionInput extends ExecutionInput {
  certificateCommitment: Hash;
  policyHash: Hash;
  inputHash: Hash;
  expiry: number; // epoch seconds
}
export interface SimulationResult {
  ok: boolean;
  reason?: string;
  simulationHash: Hash;
  gasEstimate?: bigint;
}
export interface SubmittedTx {
  txHash: Hash;
  submittedAt: number;
}
export interface ExecutionReceipt {
  txHash: Hash;
  blockNumber: number;
  status: "success" | "reverted";
  explorerUrl: string;
  confirmedAt: number;
}
export interface NetworkStatus {
  mode: "demo" | "arc-testnet";
  chainId: number;
  blockNumber: number | null;
  connected: boolean;
  label: string;
}

export interface ChainGateway {
  status(): Promise<NetworkStatus>;
  getBalance(address: Address): Promise<Money>;
  simulateProposal(input: ApprovedExecutionInput): Promise<SimulationResult>;
  submitApprovedProposal(input: ApprovedExecutionInput): Promise<SubmittedTx>;
  waitForReceipt(hash: Hash): Promise<ExecutionReceipt>;
}

/**
 * FundingGateway — a treasury-funding rail (e.g. CCTP) that tops up an Arc
 * wallet from another chain. This is P1 and NOT the primary product: it feeds
 * liquidity in; the decision engine and ChainGateway do the governed movement.
 */
export interface FundingQuoteInput {
  sourceChain: string;
  destChain: string;
  amount: Money;
}
export interface FundingQuote {
  amount: Money;
  feeBps: number;
  estimatedCompletionSec: number;
  finality: string;
  route: string;
  live: boolean;
  note: string;
}
export interface ApprovedFundingInput extends FundingQuoteInput {
  approver: string;
  proposalId: Hash;
}
export interface FundingTransfer {
  status: "planned" | "demo_settled" | "requires_source_funds" | "burned" | "attested" | "minted" | "failed";
  sourceTxHash?: Hash;
  attestation?: string;
  destTxHash?: Hash;
  note: string;
}
export interface FundingGateway {
  quote(input: FundingQuoteInput): Promise<FundingQuote>;
  bridge(input: ApprovedFundingInput): Promise<FundingTransfer>;
}
