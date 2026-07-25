import { buildDashboardModel } from "../lib/report";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const m = await buildDashboardModel();

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div>
            <div className="brand">
              ArcTreasury
              <small>Settlement Liquidity Control Plane</small>
            </div>
            <div className="badges">
              <span className="badge testnet">Arc Testnet</span>
              <span className="badge sim">Simulation</span>
              <span className="badge demo">Demo Data</span>
            </div>
          </div>
          <div className="tagline">
            Predicts corridor- and wallet-level funding needs, protects merchant and payout
            obligations, and prepares governed liquidity moves. AI may analyze and prepare;
            it may never move money. Execution stays behind deterministic policy and human approval.
          </div>
        </div>
      </header>

      <div className="wrap">
        {/* Network */}
        <section className="card">
          <h2>Arc Network</h2>
          <p className="sub">Live testnet read. Scenario data is simulated; the chain connection is real.</p>
          <div className="grid">
            <div className="stat"><div className="l">Status</div><div className="v small">{m.network.label}</div></div>
            <div className="stat"><div className="l">Chain ID</div><div className="v">{m.network.chainId}</div></div>
            <div className="stat"><div className="l">Latest block</div><div className="v">{m.network.block}</div></div>
            <div className="stat"><div className="l">Connected</div><div className="v">{m.network.connected ? <span className="ok">yes</span> : <span className="bad">no</span>}</div></div>
            {m.network.walletUsdc && <div className="stat"><div className="l">Demo-vault USDC (live)</div><div className="v small">{m.network.walletUsdc}</div></div>}
          </div>
        </section>

        {/* Live deployment */}
        <section className="card">
          <h2>Live Arc Deployment</h2>
          <p className="sub">A full governed lifecycle executed on Arc Testnet: register, human approve, execute. USDC moved through the executor to the allowlisted vault.</p>
          <div className="grid">
            <div className="stat"><div className="l">TreasuryPolicyExecutor</div><div className="v small"><a href={m.deployment.addressUrl} target="_blank" rel="noreferrer">{m.deployment.address}</a></div></div>
            <div className="stat"><div className="l">Execute tx (block {m.deployment.executeBlock})</div><div className="v small"><a href={m.deployment.executeTxUrl} target="_blank" rel="noreferrer">{m.deployment.executeTx.slice(0, 18)}…</a></div></div>
            <div className="stat"><div className="l">Certificate vs on-chain commitment</div><div className="v">{m.deployment.verified ? <span className="ok">verified</span> : <span className="bad">mismatch</span>}</div></div>
          </div>
          <div className="callout good">On-chain <span className="mono">certificateCommitmentOf</span> equals the private certificate's SHA-256 ({m.deployment.commitment.slice(0, 18)}…). Coverage proven without publishing treasury data.</div>
        </section>

        {/* Forecast */}
        <section className="card">
          <h2>48-Hour Operational Forecast — EU Settlement Wallet</h2>
          <p className="sub">Downside scenario: Friday receivable delayed to Monday, outflows +5%. As of {m.asOf}.</p>
          <div className="grid">
            <div className="stat"><div className="l">Base min balance</div><div className="v">{m.forecast.baseMin}</div></div>
            <div className="stat"><div className="l">Downside min balance</div><div className="v bad">{m.forecast.downMin}</div></div>
            <div className="stat"><div className="l">Earliest shortfall</div><div className="v small">{m.forecast.shortfallAt}</div></div>
            <div className="stat"><div className="l">Required top-up</div><div className="v">{m.forecast.requiredTopUp}</div></div>
          </div>
          <table style={{ marginTop: 18 }}>
            <thead><tr><th>Value time</th><th>Projected closing</th><th>Reserve floor</th><th>Coverage</th></tr></thead>
            <tbody>
              {m.forecast.points.map((p, i) => (
                <tr key={i}>
                  <td className="mono">{p.at}</td>
                  <td className={p.short ? "bad mono" : "mono"}>{p.closing}</td>
                  <td className="mono">{p.reserve}</td>
                  <td>{p.short ? <span className="pill fail">shortfall</span> : <span className="pill pass">covered</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Obligations */}
        <section className="card">
          <h2>Settlement Obligations</h2>
          <p className="sub">Contractual outflows the forecast must keep covered.</p>
          <table>
            <thead><tr><th>Obligation</th><th>Amount</th><th>Due (value time)</th><th>Mandatory</th></tr></thead>
            <tbody>
              {m.obligations.map((o) => (
                <tr key={o.id}>
                  <td>{o.desc}</td>
                  <td className="mono">{o.amount}</td>
                  <td className="mono">{o.due}</td>
                  <td>{o.mandatory ? <span className="pill pass">yes</span> : <span className="pill warning">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Recommendation */}
        <section className="card">
          <h2>Recommended Action — Smallest Safe Rebalance</h2>
          <p className="sub">US settlement wallet → EU settlement wallet over the 24/7 Arc rail.</p>
          <div className="grid">
            <div className="stat"><div className="l">Authoritative amount</div><div className="v">{m.recommendation.amount}</div></div>
            <div className="stat"><div className="l">Max safe amount</div><div className="v">{m.recommendation.maxSafe}</div></div>
            <div className="stat"><div className="l">Optimizer status</div><div className="v small">{m.recommendation.status}</div></div>
            <div className="stat"><div className="l">Latest safe execution</div><div className="v small">{m.recommendation.latestSafe}</div></div>
          </div>
          <div className="callout warn"><strong>Binding constraint:</strong> {m.recommendation.binding}</div>
          <div className="callout"><strong>Consequence of inaction:</strong> {m.recommendation.consequence}</div>
        </section>

        {/* Policy */}
        <section className="card">
          <h2>Deterministic Policy Evaluation</h2>
          <p className="sub">Versioned, testable, independent of any language model. A failed mandatory rule makes the proposal non-approvable.</p>
          <table>
            <thead><tr><th>Rule</th><th>Observed</th><th>Threshold</th><th>Status</th></tr></thead>
            <tbody>
              {m.policy.map((c) => (
                <tr key={c.ruleId}>
                  <td className="mono">{c.ruleId}</td>
                  <td className="mono">{c.observed}</td>
                  <td className="mono">{c.threshold}</td>
                  <td><span className={`pill ${c.status}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Certificate */}
        <section className="card">
          <h2>Settlement Coverage Certificate</h2>
          <p className="sub">Machine-verifiable proof the action keeps every mandatory obligation covered. Only the opaque commitment goes on-chain.</p>
          <div className="grid">
            <div className="stat"><div className="l">Certificate ID</div><div className="v small">{m.certificate.id}</div></div>
            <div className="stat"><div className="l">Base-case coverage</div><div className="v">{m.certificate.baseCoverage}</div></div>
            <div className="stat"><div className="l">Stressed coverage</div><div className="v">{m.certificate.stressedCoverage}</div></div>
            <div className="stat"><div className="l">Valid until</div><div className="v small">{m.certificate.validUntil}</div></div>
          </div>
          <div className="stat" style={{ marginTop: 14 }}>
            <div className="l">Commitment (SHA-256, published on Arc as bytes32)</div>
            <div className="v small">{m.certificate.commitment}</div>
          </div>
          <div className={`callout ${m.certificate.matchesChain ? "good" : "warn"}`}>
            Certificate self-consistent and {m.certificate.matchesChain ? "matches" : "compared against"} its on-chain commitment. Covers: {m.certificate.covered.join(", ")}.
          </div>
        </section>

        {/* Shadow mode */}
        <section className="card">
          <h2>Shadow Mode — ROI vs Static Buffer</h2>
          <p className="sub">Counterfactual comparison against a static 3,000,000 USDC prefunding buffer. No money moves. Formulas shown, nothing annualized.</p>
          <div className="grid">
            <div className="stat"><div className="l">Capital released</div><div className="v ok">{m.shadow.capitalReleased}</div></div>
            <div className="stat"><div className="l">Prefunding reduction</div><div className="v">{m.shadow.reductionPct}%</div></div>
            <div className="stat"><div className="l">Avoided shortfalls</div><div className="v">{m.shadow.avoidedShortfalls}</div></div>
          </div>
          <table style={{ marginTop: 16 }}>
            <thead><tr><th>Metric</th><th>ArcTreasury</th><th>Static baseline</th><th>Unit</th></tr></thead>
            <tbody>
              {m.shadow.metrics.map((mm) => (
                <tr key={mm.name}><td>{mm.name}</td><td className="mono">{mm.arc}</td><td className="mono">{mm.base}</td><td className="mono">{mm.unit}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Safety gate */}
        <section className="card">
          <h2>Safety Gate — Unsafe Action Blocked</h2>
          <p className="sub">Attempting a larger release than policy permits.</p>
          <div className="grid">
            <div className="stat"><div className="l">Attempted release</div><div className="v bad">{m.blocked.amount}</div></div>
            <div className="stat"><div className="l">Verifier passed</div><div className="v">{m.blocked.verifierPassed ? <span className="ok">yes</span> : <span className="bad">no</span>}</div></div>
            <div className="stat"><div className="l">Policy approvable</div><div className="v">{m.blocked.policyApprovable ? <span className="ok">yes</span> : <span className="bad">no</span>}</div></div>
          </div>
          <div className="callout warn">The unsafe action cannot become approvable. It exceeds the per-transaction cap; money cannot move.</div>
        </section>

        {/* Proposal lifecycle */}
        <section className="card">
          <h2>Proposal Lifecycle</h2>
          <p className="sub">Current state: <strong>{m.proposal.state}</strong>. Approved by {m.proposal.approver}. Append-only audit hash-chain.</p>
          <div className="flow">
            {["draft", "evaluated", "awaiting_approval", "approved", "executing", "settled"].map((s, i, a) => (
              <span key={s} style={{ display: "contents" }}>
                <span className="step" style={{ opacity: m.proposal.lifecycle.includes(s) || s === "draft" ? 1 : 0.35 }}>{s.replace(/_/g, " ")}</span>
                {i < a.length - 1 && <span className="arrow">→</span>}
              </span>
            ))}
          </div>
        </section>

        <p className="disclaimer">
          Prototype and testnet software. Not investment advice, not production treasury infrastructure. All balances,
          obligations, and forecasts are synthetic demo data for the fictional company Northstar Pay. ArcTreasury is
          non-custodial decisioning and orchestration software; the smart-contract control perimeter governs only the
          ERC-20 balance it custodies and the permissions defined in it, and has no authority over external bank,
          custodian, or exchange accounts.
        </p>
      </div>
    </>
  );
}
