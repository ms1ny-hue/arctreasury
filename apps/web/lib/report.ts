import {
  northstarScenario,
  runForecast,
  seriesFor,
  recommendRebalance,
  verifyAction,
  evaluatePolicy,
  buildCertificate,
  certificateSimHash,
  verifyCertificate,
  runShadowComparison,
  createProposal,
  approveProposal,
  hashValue,
  fromDecimalString,
  fmt,
  humanUtc,
  ADDR,
} from "@arctreasury/domain";
import { ArcTestnetGateway } from "@arctreasury/chain";
import { buildExplainContext, explainRecommendation } from "@arctreasury/ai";
import deployment from "../../../packages/contracts/deployments/arc-testnet.json";

export interface DashboardModel {
  asOf: string;
  network: { label: string; chainId: number; block: string; connected: boolean; walletUsdc: string | null };
  forecast: {
    baseMin: string;
    downMin: string;
    shortfallAt: string;
    requiredTopUp: string;
    points: { at: string; closing: string; reserve: string; short: boolean }[];
  };
  obligations: { id: string; desc: string; amount: string; due: string; mandatory: boolean }[];
  recommendation: {
    amount: string;
    maxSafe: string;
    status: string;
    latestSafe: string;
    binding: string;
    consequence: string;
    rail: string;
  };
  certificate: {
    id: string;
    commitment: string;
    baseCoverage: string;
    stressedCoverage: string;
    covered: string[];
    validUntil: string;
    selfConsistent: boolean;
    matchesChain: boolean;
  };
  policy: { ruleId: string; status: string; observed: string; threshold: string }[];
  shadow: { capitalReleased: string; reductionPct: string; avoidedShortfalls: number; metrics: { name: string; arc: string; base: string; unit: string }[] };
  blocked: { amount: string; verifierPassed: boolean; policyApprovable: boolean };
  proposal: { state: string; approver: string; lifecycle: string[] };
  live: {
    rpc: string;
    readAt: string;
    reachable: boolean;
    block: string;
    vaultUsdc: string | null;
    onchainExecuted: boolean | null;
    onchainCommitment: string | null;
    maxSingleAmount: string | null;
    proposalAmountOnchain: string | null;
    matchesPrivateCert: boolean | null;
    txStatus: string | null;
    txBlock: number | null;
    txLogs: number | null;
  };
  ai: { source: string; model: string | null; headline: string; whatToDo: string; bindingConstraint: string; consequenceOfInaction: string; disclaimer: string };
  deployment: {
    address: string;
    addressUrl: string;
    executeTx: string;
    executeTxUrl: string;
    executeBlock: number;
    commitment: string;
    verified: boolean;
  };
}

export async function buildDashboardModel(): Promise<DashboardModel> {
  const data = northstarScenario();

  let network: DashboardModel["network"] = { label: "ARC TESTNET", chainId: 5042002, block: "—", connected: false, walletUsdc: null };
  try {
    const arc = new ArcTestnetGateway();
    const st = await arc.status();
    const bal = await arc.getBalance(ADDR.demoVault as `0x${string}`).catch(() => null);
    network = { label: st.label, chainId: st.chainId, block: st.blockNumber === null ? "unreachable" : String(st.blockNumber), connected: st.connected, walletUsdc: bal ? fmt(bal) : null };
  } catch {
    /* offline: keep defaults */
  }

  const base = seriesFor(runForecast(data, { scenario: "base", horizonHours: 48, stepSeconds: 3600 }), "pool-eu");
  const down = seriesFor(runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 }), "pool-eu");

  const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
  const verification = verifyAction(data, rec.action);
  const policyEval = evaluatePolicy(data, rec.action);
  const simulationHash = certificateSimHash(rec);
  const cert = buildCertificate(data, rec, policyEval, simulationHash);
  const certCheck = verifyCertificate(cert, cert.commitment);
  const shadow = runShadowComparison(data, rec, { staticBuffer: fromDecimalString("3000000") });

  const unsafe = { kind: "release" as const, sourcePoolId: "pool-us", destPoolId: "pool-eu", railId: "rail-arc-internal", amount: fromDecimalString("3500000") };
  const unsafeVerify = verifyAction(data, unsafe);
  const unsafePolicy = evaluatePolicy(data, unsafe);

  let proposal = createProposal(rec, policyEval, verification, simulationHash, data.asOf, data.policy.thresholds.proposalTtlSeconds);
  proposal = approveProposal(proposal, ADDR.poolUs, data.asOf + 60, proposal.boundHashes, "0xhuman_sig");

  const explained = await explainRecommendation(buildExplainContext(data, rec, policyEval, cert));

  // --- LIVE on-chain reads of the deployed executor (proves it is not hardcoded) ---
  const usdc6 = (v: bigint) => (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 }) + " USDC";
  const live: DashboardModel["live"] = {
    rpc: "https://rpc.blockdaemon.testnet.arc.network",
    readAt: new Date().toISOString(),
    reachable: false,
    block: network.block,
    vaultUsdc: network.walletUsdc,
    onchainExecuted: null,
    onchainCommitment: null,
    maxSingleAmount: null,
    proposalAmountOnchain: null,
    matchesPrivateCert: null,
    txStatus: null,
    txBlock: null,
    txLogs: null,
  };
  try {
    const arc = new ArcTestnetGateway();
    const [ex, receipt] = await Promise.all([
      arc.readExecutorState(deployment.address as `0x${string}`, deployment.proof.proposalId as `0x${string}`),
      arc.getReceiptState(deployment.transactions.executeProposal as `0x${string}`),
    ]);
    live.reachable = true;
    live.onchainExecuted = ex.isExecuted;
    live.onchainCommitment = ex.certificateCommitment;
    live.maxSingleAmount = usdc6(ex.maxSingleAmount);
    live.proposalAmountOnchain = ex.proposal.exists ? usdc6(ex.proposal.amount) : "not found";
    live.matchesPrivateCert = ex.certificateCommitment.toLowerCase() === cert.commitment.toLowerCase();
    if (receipt) { live.txStatus = receipt.status; live.txBlock = receipt.blockNumber; live.txLogs = receipt.logs; }
  } catch {
    /* RPC unreachable: leave nulls, UI shows offline */
  }

  return {
    asOf: humanUtc(data.asOf),
    network,
    forecast: {
      baseMin: fmt(base.minBalance),
      downMin: fmt(down.minBalance),
      shortfallAt: down.timeToShortfallSec === null ? "none" : humanUtc(data.asOf + down.timeToShortfallSec),
      requiredTopUp: fmt(down.requiredTopUp),
      points: down.points.filter((_, i) => i % 3 === 0).map((p) => ({
        at: humanUtc(p.at).slice(0, 22),
        closing: fmt(p.closingBalance),
        reserve: fmt(p.requiredReserve),
        short: p.coverageShortfall.amount > 0n,
      })),
    },
    obligations: data.obligations.map((o) => ({ id: o.id, desc: o.description, amount: fmt(o.amount), due: humanUtc(o.dueAt), mandatory: o.mandatory })),
    recommendation: {
      amount: fmt(rec.authoritativeAmount),
      maxSafe: fmt(rec.maxSafeAmount),
      status: rec.optimizerStatus,
      latestSafe: humanUtc(rec.latestSafeExecutionAt),
      binding: rec.bindingConstraint,
      consequence: rec.consequenceOfInaction,
      rail: rec.action.railId,
    },
    certificate: {
      id: cert.certificateId,
      commitment: cert.commitment,
      baseCoverage: fmt(cert.baseCaseMinCoverage),
      stressedCoverage: fmt(cert.stressedMinCoverage),
      covered: cert.coveredObligationIds,
      validUntil: humanUtc(cert.validUntil),
      // Real comparison against the anchored on-chain bytes32 (not a self-check).
      // Null when the RPC is unreachable — then we do NOT claim a chain match.
      selfConsistent: certCheck.matchesChain === true,
      matchesChain: live.matchesPrivateCert === true,
    },
    policy: policyEval.checks.map((c) => ({ ruleId: c.ruleId, status: c.status, observed: c.observedValue, threshold: c.threshold })),
    shadow: {
      capitalReleased: fmt(shadow.capitalReleased),
      reductionPct: shadow.reductionPct,
      avoidedShortfalls: shadow.avoidedShortfalls,
      metrics: shadow.metrics.map((m) => ({ name: m.name, arc: m.arctreasury, base: m.baseline, unit: m.unit })),
    },
    blocked: { amount: fmt(unsafe.amount), verifierPassed: unsafeVerify.passed, policyApprovable: unsafePolicy.approvable },
    proposal: { state: proposal.state, approver: proposal.approval?.approver ?? "-", lifecycle: proposal.audit.map((a) => a.kind) },
    live,
    ai: {
      source: explained.source,
      model: explained.model ?? null,
      headline: explained.explanation.headline,
      whatToDo: explained.explanation.whatToDo,
      bindingConstraint: explained.explanation.bindingConstraint,
      consequenceOfInaction: explained.explanation.consequenceOfInaction,
      disclaimer: explained.disclaimer,
    },
    deployment: {
      address: deployment.address,
      addressUrl: deployment.explorer,
      executeTx: deployment.transactions.executeProposal,
      executeTxUrl: `https://testnet.arcscan.app/tx/${deployment.transactions.executeProposal}`,
      executeBlock: deployment.proof.executeBlock,
      commitment: deployment.certificateCommitment,
      verified: deployment.proof.onchainCertificateCommitmentMatchesPrivateCertificate,
    },
  };
}
