import { fromDecimalString as usdc } from "./money.js";
import type { TreasuryScenarioData } from "./entities.js";

/**
 * Northstar Pay — the single coherent demo scenario.
 *
 * A cross-border PSP paying merchants and contractors in USDC across two
 * corridors. The incident: a Friday fiat receivable is delayed to Monday, so
 * the EU settlement wallet cannot cover weekend contractor payouts under the
 * downside scenario. The US wallet holds safely releasable excess. The safe
 * fix is the SMALLEST Arc rebalance from US -> EU that keeps every mandatory
 * obligation covered under stress. Banks are closed over the weekend; the Arc
 * rail settles 24/7, which is exactly why stablecoin-native rails change what
 * is possible here.
 *
 * All data is SIMULATED / DEMO. No real customer funds.
 */
export const HOUR = 3600;
export const DAY = 86400;

/** Fri 24 Jul 2026 13:00:00 UTC (09:00 ET). Deterministic clock. */
export const ASOF = 1784898000;

// Wallet addresses (lowercase; allowlist matching is case-insensitive).
export const ADDR = {
  poolEu: "0xee00000000000000000000000000000000000001",
  poolUs: "0xa5a5000000000000000000000000000000000002",
  demoVault: "0xdada0000000000000000000000000000000d0001",
  unapproved: "0xbadbad0000000000000000000000000000bad001",
} as const;

export function northstarScenario(): TreasuryScenarioData {
  return {
    accountId: "northstar-pay",
    asOf: ASOF,
    dataStatus: "demo",
    corridors: [
      { id: "corridor-eu", label: "EU merchant + contractor", counterparty: "EU acquiring + payroll", mandatory: true },
      { id: "corridor-us", label: "US settlement", counterparty: "US acquiring", mandatory: true },
    ],
    pools: [
      {
        id: "pool-eu",
        label: "EU settlement wallet",
        walletAddress: ADDR.poolEu,
        corridorId: "corridor-eu",
        balance: usdc("3200000"),
        operatingReserve: usdc("500000"),
        stressedReserve: usdc("800000"),
      },
      {
        id: "pool-us",
        label: "US settlement wallet",
        walletAddress: ADDR.poolUs,
        corridorId: "corridor-us",
        balance: usdc("6500000"),
        operatingReserve: usdc("400000"),
        stressedReserve: usdc("600000"),
      },
    ],
    obligations: [
      {
        id: "ob-merchant-fri",
        corridorId: "corridor-eu",
        poolId: "pool-eu",
        kind: "merchant_settlement",
        amount: usdc("2400000"),
        dueAt: ASOF + 3 * HOUR, // Fri 16:00 UTC
        slaAt: ASOF + 3 * HOUR,
        mandatory: true,
        description: "Friday EU merchant settlement batch",
      },
      {
        id: "ob-payout-sat",
        corridorId: "corridor-eu",
        poolId: "pool-eu",
        kind: "contractor_payout",
        amount: usdc("1800000"),
        dueAt: ASOF + 23 * HOUR, // Sat 12:00 UTC
        slaAt: ASOF + 23 * HOUR,
        mandatory: true,
        description: "Weekend contractor payouts (SLA-bound)",
      },
      {
        id: "ob-fee-us",
        corridorId: "corridor-us",
        poolId: "pool-us",
        kind: "fee",
        amount: usdc("120000"),
        dueAt: ASOF + 6 * HOUR,
        slaAt: ASOF + 6 * HOUR,
        mandatory: false,
        description: "US network fees",
      },
    ],
    cashFlows: [
      {
        id: "cf-recv-fri",
        poolId: "pool-eu",
        corridorId: "corridor-eu",
        direction: "inflow",
        amount: usdc("2000000"),
        valueAt: ASOF + 2 * HOUR, // base: Fri 15:00; downside shifts to Monday
        certainty: "at_risk",
        source: "EU acquiring bank",
        description: "Friday fiat receivable (AT RISK of delay to Monday)",
      },
      {
        id: "cf-recv-mon",
        poolId: "pool-eu",
        corridorId: "corridor-eu",
        direction: "inflow",
        amount: usdc("1500000"),
        valueAt: ASOF + 3 * DAY + 1 * HOUR, // Mon 14:00 UTC
        certainty: "scheduled",
        source: "EU acquiring bank",
        description: "Monday bank-funded receivable",
      },
      {
        id: "cf-usdc-in-us",
        poolId: "pool-us",
        corridorId: "corridor-us",
        direction: "inflow",
        amount: usdc("900000"),
        valueAt: ASOF + 5 * HOUR,
        certainty: "expected",
        source: "US acquiring (USDC)",
        description: "US USDC settlement inflow",
      },
    ],
    rails: [
      {
        id: "rail-arc-internal",
        label: "Arc internal USDC transfer",
        sourceAsset: "USDC",
        destAsset: "USDC",
        sourceNetwork: "arc-testnet",
        destNetwork: "arc-testnet",
        expectedCompletionSec: 5,
        conservativeCompletionSec: 300,
        finalityCondition: "1 confirmed block (sub-second settlement)",
        feeBps: 0,
        minSize: usdc("1"),
        maxSize: usdc("10000000"),
        health: "healthy",
        counterparty: "self-custody Arc wallet",
        provider: "Arc",
        provenance: "on-chain read",
        lastUpdatedAt: ASOF,
      },
      {
        id: "rail-bank-eur",
        label: "EUR bank wire funding",
        sourceAsset: "EUR",
        destAsset: "USDC",
        sourceNetwork: "sepa",
        destNetwork: "arc-testnet",
        expectedCompletionSec: 6 * HOUR,
        conservativeCompletionSec: 3 * DAY,
        finalityCondition: "bank credit + mint confirmation",
        feeBps: 10,
        minSize: usdc("50000"),
        maxSize: usdc("5000000"),
        health: "degraded", // weekend: closed
        counterparty: "EU acquiring bank",
        provider: "bank",
        provenance: "operations calendar",
        lastUpdatedAt: ASOF,
      },
    ],
    railWindows: [
      { railId: "rail-arc-internal", opensAt: ASOF - DAY, cutoffAt: ASOF + 7 * DAY, note: "24/7 on-chain" },
      { railId: "rail-bank-eur", opensAt: ASOF, cutoffAt: ASOF + 5 * HOUR, note: "Fri bank cutoff 18:00 UTC; closed Sat/Sun" },
    ],
    routes: [
      { id: "route-us-eu", railId: "rail-arc-internal", sourcePoolId: "pool-us", destPoolId: "pool-eu", riskPenaltyBps: 1 },
      { id: "route-eu-vault", railId: "rail-arc-internal", sourcePoolId: "pool-eu", destPoolId: "pool-eu", riskPenaltyBps: 1 },
    ],
    policy: {
      policyId: "northstar-treasury-policy",
      version: "2026.07.1",
      effectiveAt: ASOF - 30 * DAY,
      thresholds: {
        maxSingleTransaction: usdc("3000000"),
        maxDailyAggregate: usdc("5000000"),
        minSettlementCoverageRatioBps: 10000, // 100%
        approvedDestinations: [ADDR.poolEu, ADDR.poolUs, ADDR.demoVault],
        approvedInstruments: ["rail-arc-internal"],
        counterpartyConcentrationBps: 7000,
        proposalTtlSeconds: 2 * HOUR,
        twoPersonThreshold: usdc("2500000"),
      },
    },
  };
}
