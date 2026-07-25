import { ARC_TESTNET } from "@arctreasury/config";
import type { ApprovedFundingInput, FundingGateway, FundingQuote, FundingQuoteInput, FundingTransfer } from "./gateway.js";

/**
 * CCTP funding rail (P1). Circle's Cross-Chain Transfer Protocol burns USDC on a
 * source chain and mints it on Arc. Domains and the on-chain TokenMessengerV2
 * are the verified Arc Testnet values from config; the domain map below covers
 * the common CCTP testnet domains.
 *
 * HONESTY NOTE: the live burn/attest/mint path requires USDC on a source chain
 * (e.g. Ethereum Sepolia) and Circle's attestation service. That funding is not
 * yet in place, so `bridge()` on the live adapter returns `requires_source_funds`
 * rather than guessing a contract call. The route, fee, domain, and contract are
 * real; the transfer is honestly gated. `DemoFundingGateway` gives a
 * deterministic, clearly-labelled path for the walkthrough.
 */
export const CCTP_DOMAINS: Record<string, number> = {
  "ethereum-sepolia": 0,
  "avalanche-fuji": 1,
  "base-sepolia": 6,
  "arbitrum-sepolia": 3,
  "arc-testnet": 26,
};

const HOUR = 3600;

export class DemoFundingGateway implements FundingGateway {
  async quote(input: FundingQuoteInput): Promise<FundingQuote> {
    return {
      amount: input.amount,
      feeBps: 0,
      estimatedCompletionSec: 20 * 60,
      finality: "CCTP attestation + mint (demo)",
      route: `${input.sourceChain} -> ${input.destChain} via CCTP (DEMO)`,
      live: false,
      note: "Deterministic demo quote. No real burn/mint.",
    };
  }
  async bridge(input: ApprovedFundingInput): Promise<FundingTransfer> {
    return {
      status: "demo_settled",
      note: `DEMO: ${input.approver} funded ${input.destChain} with the quoted amount. No real on-chain transfer.`,
    };
  }
}

export interface CctpConfig {
  attestationApi?: string; // Circle iris sandbox
}

export class CctpFundingGateway implements FundingGateway {
  private readonly tokenMessenger = ARC_TESTNET.contracts.cctpTokenMessengerV2;
  constructor(private readonly cfg: CctpConfig = {}) {}

  async quote(input: FundingQuoteInput): Promise<FundingQuote> {
    const srcDomain = CCTP_DOMAINS[input.sourceChain];
    const dstDomain = CCTP_DOMAINS[input.destChain];
    const known = srcDomain !== undefined && dstDomain !== undefined;
    // CCTP standard transfer has no protocol fee on testnet; fast transfer would.
    return {
      amount: input.amount,
      feeBps: 0,
      estimatedCompletionSec: known ? 20 * HOUR / 60 : 0,
      finality: "source finality + Circle attestation + Arc mint",
      route: known
        ? `${input.sourceChain}(domain ${srcDomain}) -> ${input.destChain}(domain ${dstDomain}) via TokenMessengerV2 ${this.tokenMessenger}`
        : `unsupported domain pairing`,
      live: known,
      note: known
        ? "Real CCTP route. Live burn/mint requires USDC on the source chain and Circle attestation."
        : `Unknown CCTP domain for ${input.sourceChain} or ${input.destChain}.`,
    };
  }

  async bridge(_input: ApprovedFundingInput): Promise<FundingTransfer> {
    // The burn call is depositForBurn on TokenMessengerV2, followed by polling
    // Circle's attestation service and calling receiveMessage on Arc. That path
    // is gated on funding a source-chain wallet with testnet USDC, which is not
    // yet in place. We return an honest status rather than a guessed tx.
    return {
      status: "requires_source_funds",
      note: `CCTP burn is wired to ${this.tokenMessenger}, but no source-chain USDC is funded. Fund an Ethereum Sepolia wallet via faucet.circle.com, then the burn/attest/mint flow can run. Attestation API: ${this.cfg.attestationApi ?? "https://iris-api-sandbox.circle.com"}.`,
    };
  }
}
