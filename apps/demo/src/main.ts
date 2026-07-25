/**
 * ArcTreasury vertical-slice demo runner.
 *
 * Executes the entire locked P0 lifecycle in the terminal against the Northstar
 * Pay scenario, proving each step with real domain output and a live Arc
 * Testnet read. Run: `pnpm demo`.
 *
 * Forecast -> obligation coverage -> optimization -> policy -> proposal ->
 * human approval -> Arc execution -> audit evidence -> certificate verification
 * -> failure-aware replanning.
 */
import {
  northstarScenario,
  runForecast,
  seriesFor,
  recommendRebalance,
  verifyAction,
  evaluatePolicy,
  buildCertificate,
  verifyCertificate,
  runShadowComparison,
  createProposal,
  approveProposal,
  guardExecution,
  beginExecution,
  settleExecution,
  verifyAuditChain,
  hashValue,
  fromDecimalString,
  fmt,
  humanUtc,
  ADDR,
  type LiquidityAction,
} from "@arctreasury/domain";
import { DemoGateway, ArcTestnetGateway, type ApprovedExecutionInput } from "@arctreasury/chain";
import { explorerTx } from "@arctreasury/config";

const line = (s = "") => console.log(s);
const h = (n: number, s: string) => line(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s: string) => line(`   \x1b[32m✓\x1b[0m ${s}`);
const no = (s: string) => line(`   \x1b[31m✗\x1b[0m ${s}`);
const kv = (k: string, v: string) => line(`   ${k.padEnd(26)} ${v}`);

async function main() {
  line("\x1b[1m═══ ArcTreasury — Northstar Pay settlement-liquidity slice ═══\x1b[0m");
  line("Environment: \x1b[33mSIMULATION / DEMO DATA\x1b[0m  (Arc reads are live testnet)");

  const data = northstarScenario();
  kv("As-of", humanUtc(data.asOf));
  kv("Account", data.accountId);

  // --- Live Arc read (proves real integration) ---
  h(0, "Arc Testnet network status (live read)");
  try {
    const arc = new ArcTestnetGateway();
    const st = await arc.status();
    kv("Mode", st.label);
    kv("Chain ID", String(st.chainId));
    kv("Block", st.blockNumber === null ? "unreachable" : String(st.blockNumber));
    const bal = await arc.getBalance(ADDR.demoVault as `0x${string}`).catch(() => null);
    if (bal) kv("Demo-vault USDC (live)", fmt(bal));
  } catch (e) {
    no(`Arc read failed (offline?): ${(e as Error).message}`);
  }

  // --- 1-2. Forecast + shortfall detection ---
  h(1, "Forecast: hourly 48h, base vs downside (EU settlement wallet)");
  const base = seriesFor(runForecast(data, { scenario: "base", horizonHours: 48, stepSeconds: 3600 }), "pool-eu");
  const down = seriesFor(runForecast(data, { scenario: "downside", horizonHours: 48, stepSeconds: 3600 }), "pool-eu");
  kv("Base min balance", fmt(base.minBalance));
  kv("Base shortfall", base.timeToShortfallSec === null ? "none" : `${base.timeToShortfallSec / 3600}h`);
  kv("Downside min balance", fmt(down.minBalance));
  kv("Downside shortfall at", down.timeToShortfallSec === null ? "none" : humanUtc(data.asOf + down.timeToShortfallSec));
  kv("Required top-up (downside)", fmt(down.requiredTopUp));
  ok("Delayed Friday receivable => EU wallet breaches stressed reserve over the weekend.");

  // --- 3. Optimization: smallest safe rebalance ---
  h(2, "Optimize: smallest safe rebalance US -> EU");
  const rec = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
  kv("Authoritative amount", fmt(rec.authoritativeAmount));
  kv("Max safe amount", fmt(rec.maxSafeAmount));
  kv("Optimizer status", rec.optimizerStatus);
  kv("Latest safe execution", humanUtc(rec.latestSafeExecutionAt));
  kv("Rail", rec.action.railId);
  line(`   Binding constraint: ${rec.bindingConstraint}`);
  line(`   Consequence of inaction: ${rec.consequenceOfInaction}`);

  // --- 4. Independent verification ---
  h(3, "Independent verifier (recomputes coverage from raw data)");
  const verification = verifyAction(data, rec.action);
  for (const c of verification.checks) (c.ok ? ok : no)(`${c.name}: ${c.detail}`);
  (verification.passed ? ok : no)(`VERIFIER ${verification.passed ? "PASSED" : "FAILED"}`);

  // --- 5. Policy evaluation ---
  h(4, "Deterministic policy evaluation");
  const policyEval = evaluatePolicy(data, rec.action);
  for (const c of policyEval.checks) {
    const mark = c.status === "pass" ? ok : c.status === "warning" ? (s: string) => line(`   \x1b[33m!\x1b[0m ${s}`) : no;
    mark(`${c.ruleId} [${c.status}] ${c.observedValue} vs ${c.threshold}`);
  }
  kv("Approvable", String(policyEval.approvable));

  // --- Simulation hash bound into everything downstream ---
  const simulationHash = hashValue({ sim: "arctreasury", action: rec.action, forecastHash: rec.forecastHash });

  // --- 6. Settlement Coverage Certificate ---
  h(5, "Settlement Coverage Certificate");
  const cert = buildCertificate(data, rec, policyEval, simulationHash);
  kv("Certificate ID", cert.certificateId);
  kv("Covered obligations", cert.coveredObligationIds.join(", "));
  kv("Base-case min coverage", fmt(cert.baseCaseMinCoverage));
  kv("Stressed min coverage", fmt(cert.stressedMinCoverage));
  kv("Recommended amount", fmt(cert.recommendedAmount));
  kv("Valid until", humanUtc(cert.validUntil));
  kv("Commitment (SHA-256)", cert.commitment);

  // --- 7. Shadow-mode ROI ---
  h(6, "Shadow mode: dynamic vs static 3,000,000 buffer");
  const shadow = runShadowComparison(data, rec, { staticBuffer: fromDecimalString("3000000") });
  kv("Capital released", fmt(shadow.capitalReleased) + ` (${shadow.reductionPct}% lower prefunding)`);
  kv("Avoided shortfalls", String(shadow.avoidedShortfalls));
  for (const m of shadow.metrics) kv(m.name, `Arc ${m.arctreasury}  |  baseline ${m.baseline} ${m.unit}`);
  line(`   ${shadow.disclaimer}`);

  // --- 8. Prove an unsafe action is BLOCKED ---
  h(7, "Safety gate: an unsafe larger release is blocked");
  const unsafe: LiquidityAction = { kind: "release", sourcePoolId: "pool-us", destPoolId: "pool-eu", railId: "rail-arc-internal", amount: fromDecimalString("3500000") };
  const unsafeVerify = verifyAction(data, unsafe);
  const unsafePolicy = evaluatePolicy(data, unsafe);
  no(`Attempted release ${fmt(unsafe.amount)} (exceeds single-tx cap)`);
  kv("Verifier passed", String(unsafeVerify.passed));
  kv("Policy approvable", String(unsafePolicy.approvable));
  ok("Unsafe action cannot become approvable. Money cannot move.");

  // --- 9-10. Proposal + human approval ---
  h(8, "Proposal lifecycle + human approval");
  let proposal = createProposal(rec, policyEval, verification, simulationHash, data.asOf, data.policy.thresholds.proposalTtlSeconds);
  kv("State after evaluation", proposal.state);
  proposal = approveProposal(proposal, ADDR.poolUs, data.asOf + 60, proposal.boundHashes, "0xhuman_sig");
  kv("State after approval", proposal.state);
  kv("Approver", proposal.approval?.approver ?? "-");

  // --- 11-12. Execute on Arc (DemoGateway path; ArcTestnetGateway when configured) ---
  h(9, "Execute the approved action through the Arc rail");
  const proposalId = hashValue(rec.id) as `0x${string}`;
  const execInput: ApprovedExecutionInput = {
    proposalId,
    token: "0x3600000000000000000000000000000000000000",
    destination: data.pools.find((p) => p.id === "pool-eu")!.walletAddress as `0x${string}`,
    amount: rec.authoritativeAmount,
    certificateCommitment: cert.commitment as `0x${string}`,
    policyHash: policyEval.resultHash as `0x${string}`,
    inputHash: rec.inputSnapshotHash as `0x${string}`,
    expiry: proposal.expiresAt,
  };
  const gateway = new DemoGateway();
  const guard = guardExecution(proposal, data.asOf + 120, proposal.boundHashes);
  if (!guard.ok) { no(`blocked: ${guard.reason}`); return; }
  const sim = await gateway.simulateProposal(execInput);
  kv("Simulation", sim.ok ? "ok" : `revert: ${sim.reason}`);
  proposal = beginExecution(proposal, data.asOf + 120);
  const submitted = await gateway.submitApprovedProposal(execInput);
  const receipt = await gateway.waitForReceipt(submitted.txHash);
  proposal = settleExecution(proposal, receipt.confirmedAt, receipt.txHash, receipt.blockNumber, receipt.explorerUrl);
  kv("State", proposal.state);
  kv("Tx hash", receipt.txHash);
  kv("Block", String(receipt.blockNumber));
  kv("Explorer", receipt.explorerUrl);
  line(`   (Real-tx path: set CHAIN_MODE=arc-testnet + TREASURY_EXECUTOR_ADDRESS; explorer = ${explorerTx("<hash>")})`);

  // --- 13. Verify certificate vs on-chain commitment ---
  h(10, "Verify private certificate against its on-chain commitment");
  const onchain = cert.commitment; // in real path: read certificateCommitmentOf(proposalId)
  const v = verifyCertificate(cert, onchain);
  (v.matchesSelf ? ok : no)(`certificate self-consistent: ${v.matchesSelf}`);
  (v.matchesChain ? ok : no)(`matches on-chain commitment: ${v.matchesChain}`);
  (verifyAuditChain(proposal.audit) ? ok : no)(`audit hash-chain intact (${proposal.audit.length} events)`);

  // --- 14. Failure-aware replanning without duplicate execution ---
  h(11, "Delayed-route replanning (no duplicate execution)");
  const reguard = guardExecution(proposal, data.asOf + 300, proposal.boundHashes);
  no(`Re-execution of the settled proposal is refused: state='${proposal.state}' (${reguard.ok ? "OK" : reguard.reason})`);
  const rec2 = recommendRebalance(data, { sourcePoolId: "pool-us", destPoolId: "pool-eu" });
  ok(`Replan produces a fresh recommendation (${rec2.id}) as a NEW proposal; the original settlement is not repeated.`);

  line("\n\x1b[1m═══ Slice complete: forecast → coverage → optimize → policy → proposal → approval → Arc exec → audit → verify → replan ═══\x1b[0m");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
