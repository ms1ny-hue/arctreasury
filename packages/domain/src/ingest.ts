import { z } from "zod";
import { fromDecimalString, toDecimalString, type Money } from "./money.js";
import type { TreasuryScenarioData } from "./entities.js";

/**
 * External ingestion boundary. The engine is a pure function of a
 * TreasuryScenarioData; this schema is how an ARBITRARY external dataset (any
 * payment company's settlement position) enters the system. Money arrives as
 * exact decimal strings (never JS floats) and times as epoch seconds. Validate
 * here, then map to the internal bigint domain. No fixture is baked into the
 * engine: any dataset that satisfies this schema produces its own result.
 */
const Money6 = z.string().regex(/^-?\d+(\.\d{1,6})?$/, "decimal string, up to 6 dp");
const Addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Epoch = z.number().int().nonnegative();

const PoolIn = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  walletAddress: Addr,
  corridorId: z.string(),
  balance: Money6,
  operatingReserve: Money6,
  stressedReserve: Money6,
});
const CorridorIn = z.object({ id: z.string(), label: z.string(), counterparty: z.string(), mandatory: z.boolean() });
const ObligationIn = z.object({
  id: z.string(), corridorId: z.string(), poolId: z.string(),
  kind: z.enum(["merchant_settlement", "contractor_payout", "fee", "reserve"]),
  amount: Money6, dueAt: Epoch, slaAt: Epoch, mandatory: z.boolean(), description: z.string().max(240),
});
const CashFlowIn = z.object({
  id: z.string(), poolId: z.string(), corridorId: z.string(),
  direction: z.enum(["inflow", "outflow"]), amount: Money6, valueAt: Epoch,
  certainty: z.enum(["scheduled", "expected", "at_risk"]), source: z.string(), description: z.string().max(240),
});
const RailIn = z.object({
  id: z.string(), label: z.string(), sourceAsset: z.string(), destAsset: z.string(),
  sourceNetwork: z.string(), destNetwork: z.string(),
  expectedCompletionSec: z.number().int().nonnegative(), conservativeCompletionSec: z.number().int().nonnegative(),
  finalityCondition: z.string(), feeBps: z.number().int().nonnegative(),
  minSize: Money6, maxSize: Money6,
  health: z.enum(["healthy", "degraded", "down"]), counterparty: z.string(), provider: z.string(),
  provenance: z.string(), lastUpdatedAt: Epoch,
});
const RailWindowIn = z.object({ railId: z.string(), opensAt: Epoch, cutoffAt: Epoch, note: z.string() });
const RouteIn = z.object({ id: z.string(), railId: z.string(), sourcePoolId: z.string(), destPoolId: z.string(), riskPenaltyBps: z.number().int().nonnegative() });
const PolicyIn = z.object({
  policyId: z.string(), version: z.string(), effectiveAt: Epoch,
  thresholds: z.object({
    maxSingleTransaction: Money6, maxDailyAggregate: Money6,
    minSettlementCoverageRatioBps: z.number().int(), approvedDestinations: z.array(Addr),
    approvedInstruments: z.array(z.string()), counterpartyConcentrationBps: z.number().int(),
    proposalTtlSeconds: z.number().int().positive(), twoPersonThreshold: Money6,
  }),
});

export const ScenarioInputSchema = z.object({
  accountId: z.string().min(1).max(80),
  asOf: Epoch,
  dataStatus: z.enum(["live", "testnet", "simulated", "demo"]),
  pools: z.array(PoolIn),
  corridors: z.array(CorridorIn),
  obligations: z.array(ObligationIn),
  cashFlows: z.array(CashFlowIn),
  rails: z.array(RailIn),
  railWindows: z.array(RailWindowIn),
  routes: z.array(RouteIn),
  policy: PolicyIn,
});
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;

/** Validate an arbitrary JSON dataset. Throws a ZodError with field paths. */
export function parseScenarioInput(json: unknown): ScenarioInput {
  return ScenarioInputSchema.parse(json);
}

const m = (s: string): Money => fromDecimalString(s);

/** Map a validated external dataset to the internal (bigint) domain type. */
export function toScenario(input: ScenarioInput): TreasuryScenarioData {
  return {
    accountId: input.accountId,
    asOf: input.asOf,
    dataStatus: input.dataStatus,
    pools: input.pools.map((p) => ({ ...p, balance: m(p.balance), operatingReserve: m(p.operatingReserve), stressedReserve: m(p.stressedReserve) })),
    corridors: input.corridors,
    obligations: input.obligations.map((o) => ({ ...o, amount: m(o.amount) })),
    cashFlows: input.cashFlows.map((c) => ({ ...c, amount: m(c.amount) })),
    rails: input.rails.map((r) => ({ ...r, minSize: m(r.minSize), maxSize: m(r.maxSize) })),
    railWindows: input.railWindows,
    routes: input.routes,
    policy: {
      policyId: input.policy.policyId, version: input.policy.version, effectiveAt: input.policy.effectiveAt,
      thresholds: {
        ...input.policy.thresholds,
        maxSingleTransaction: m(input.policy.thresholds.maxSingleTransaction),
        maxDailyAggregate: m(input.policy.thresholds.maxDailyAggregate),
        twoPersonThreshold: m(input.policy.thresholds.twoPersonThreshold),
      },
    },
  };
}

/** Export an internal scenario back to the external input format (for examples/round-trip). */
export function scenarioToInput(data: TreasuryScenarioData): ScenarioInput {
  const d = (x: Money) => toDecimalString(x);
  return {
    accountId: data.accountId,
    asOf: data.asOf,
    dataStatus: data.dataStatus,
    pools: data.pools.map((p) => ({ id: p.id, label: p.label, walletAddress: p.walletAddress, corridorId: p.corridorId, balance: d(p.balance), operatingReserve: d(p.operatingReserve), stressedReserve: d(p.stressedReserve) })),
    corridors: data.corridors,
    obligations: data.obligations.map((o) => ({ id: o.id, corridorId: o.corridorId, poolId: o.poolId, kind: o.kind, amount: d(o.amount), dueAt: o.dueAt, slaAt: o.slaAt, mandatory: o.mandatory, description: o.description })),
    cashFlows: data.cashFlows.map((c) => ({ id: c.id, poolId: c.poolId, corridorId: c.corridorId, direction: c.direction, amount: d(c.amount), valueAt: c.valueAt, certainty: c.certainty, source: c.source, description: c.description })),
    rails: data.rails.map((r) => ({ id: r.id, label: r.label, sourceAsset: r.sourceAsset, destAsset: r.destAsset, sourceNetwork: r.sourceNetwork, destNetwork: r.destNetwork, expectedCompletionSec: r.expectedCompletionSec, conservativeCompletionSec: r.conservativeCompletionSec, finalityCondition: r.finalityCondition, feeBps: r.feeBps, minSize: d(r.minSize), maxSize: d(r.maxSize), health: r.health, counterparty: r.counterparty, provider: r.provider, provenance: r.provenance, lastUpdatedAt: r.lastUpdatedAt })),
    railWindows: data.railWindows,
    routes: data.routes,
    policy: {
      policyId: data.policy.policyId, version: data.policy.version, effectiveAt: data.policy.effectiveAt,
      thresholds: {
        maxSingleTransaction: d(data.policy.thresholds.maxSingleTransaction),
        maxDailyAggregate: d(data.policy.thresholds.maxDailyAggregate),
        minSettlementCoverageRatioBps: data.policy.thresholds.minSettlementCoverageRatioBps,
        approvedDestinations: data.policy.thresholds.approvedDestinations,
        approvedInstruments: data.policy.thresholds.approvedInstruments,
        counterpartyConcentrationBps: data.policy.thresholds.counterpartyConcentrationBps,
        proposalTtlSeconds: data.policy.thresholds.proposalTtlSeconds,
        twoPersonThreshold: d(data.policy.thresholds.twoPersonThreshold),
      },
    },
  };
}
