import { buildDashboardModel } from "../lib/report";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const m = await buildDashboardModel();

  return (
    <>
      <nav className="top">
        <div className="nav-in">
          <div className="wordmark"><span className="dot" />ArcTreasury</div>
          <div className="nav-right">
            <span className="live">
              <span className="pulse" /> ARC TESTNET · block <b>{m.network.block}</b>
            </span>
            <a className="nav-link" href={m.deployment.addressUrl} target="_blank" rel="noreferrer">Contract ↗</a>
            <a className="nav-link" href="https://github.com/ms1ny-hue/arctreasury" target="_blank" rel="noreferrer">Repo ↗</a>
          </div>
        </div>
      </nav>

      <div className="shell">
        {/* HERO */}
        <header className="hero">
          <span className="eyebrow">Settlement liquidity control plane · built on Arc</span>
          <h1>
            Fund the <span className="grad">smallest safe amount</span>. Prove every payout stays covered.
          </h1>
          <p className="lede">
            Cross-border payment companies trap millions in idle prefunding, or miss an SLA-bound payout when a
            receivable slips. ArcTreasury sizes the exact USDC each settlement wallet needs before cutoffs and
            weekends, moves only that, and issues a machine-verifiable coverage certificate. <b>AI analyzes and
            prepares; a human approves; deterministic policy executes on Arc.</b>
          </p>
          <div className="badges">
            <span className="badge on">Live on Arc Testnet</span>
            <span className="badge">Simulated treasury data</span>
            <span className="badge">Non-custodial</span>
          </div>

          {/* incident narrative */}
          <div className="incident">
            <div className="incident-in">
              <div className="inc-step"><div className="inc-k">The trigger</div><div className="inc-v bad">Friday receivable delayed to Monday</div></div>
              <div className="inc-step"><div className="inc-k">The exposure</div><div className="inc-v bad">EU wallet short {m.forecast.requiredTopUp} for weekend payouts</div></div>
              <div className="inc-step"><div className="inc-k">The move</div><div className="inc-v flow">Rebalance {m.recommendation.amount} US → EU over the 24/7 Arc rail</div></div>
              <div className="inc-step"><div className="inc-k">The proof</div><div className="inc-v ok">Executed on-chain · coverage certified</div></div>
            </div>
          </div>
        </header>

        {/* PROBLEM / JOB / PROOF */}
        <div className="band">
          <div className="band-card">
            <div className="band-ico a">!</div>
            <h3>The problem is timing, not tooling</h3>
            <p>Settlement runs 24/7; banks don&apos;t. Overfund and capital sits idle; underfund and a merchant or contractor payout misses its SLA. Static buffers guess.</p>
          </div>
          <div className="band-card">
            <div className="band-ico b">→</div>
            <h3>The job before every cutoff</h3>
            <p>Decide exactly how much each wallet needs, move only that over a rail that settles in time, and keep every mandatory obligation covered under stress.</p>
          </div>
          <div className="band-card">
            <div className="band-ico c">✓</div>
            <h3>Proof an approver can trust</h3>
            <p>A Settlement Coverage Certificate whose opaque hash is published on Arc: coverage is provable without exposing balances, corridors, or payout schedules.</p>
          </div>
        </div>

        {/* KPI proof */}
        <div className="kpis">
          <div className="kpi"><div className="num">{m.shadow.capitalReleased.replace(" USDC", "")}</div><div className="lab">Capital released</div><div className="sub">vs a static prefunding buffer</div></div>
          <div className="kpi"><div className="num">−{m.shadow.reductionPct}%</div><div className="lab">Prefunding reduction</div><div className="sub">same obligations, less trapped cash</div></div>
          <div className="kpi"><div className="num">100%</div><div className="lab">Mandatory coverage</div><div className="sub">verified under the stressed scenario</div></div>
          <div className="kpi"><div className="num">{m.shadow.avoidedShortfalls}</div><div className="lab">Shortfall avoided</div><div className="sub">weekend payout, would have missed</div></div>
        </div>

        {/* LIVE ARC */}
        <section className="card live-card">
          <div className="card-eyebrow">◆ Live on Arc Testnet</div>
          <h2>A full governed lifecycle, executed on-chain</h2>
          <p className="sub">Register → human approve → execute. USDC moved through the policy executor to an allowlisted vault, and the private certificate was verified against its on-chain commitment.</p>
          <div className="grid">
            <div className="stat"><div className="l">TreasuryPolicyExecutor</div><div className="v small"><a href={m.deployment.addressUrl} target="_blank" rel="noreferrer">{m.deployment.address}</a></div></div>
            <div className="stat"><div className="l">Execute tx · block {m.deployment.executeBlock}</div><div className="v small"><a href={m.deployment.executeTxUrl} target="_blank" rel="noreferrer">{m.deployment.executeTx.slice(0, 22)}…</a></div></div>
            <div className="stat"><div className="l">Certificate vs on-chain commitment</div><div className="v">{m.deployment.verified ? <span className="good">verified ✓</span> : <span className="hot">mismatch</span>}</div></div>
          </div>
          <div className="callout good">On-chain <span className="mono">certificateCommitmentOf</span> equals the private certificate&apos;s SHA-256 (<span className="mono">{m.deployment.commitment.slice(0, 22)}…</span>). Coverage proven without publishing treasury data.</div>
        </section>

        {/* RECOMMENDATION */}
        <section className="card">
          <div className="card-eyebrow">Decision</div>
          <h2>Recommended action — the smallest safe rebalance</h2>
          <p className="sub">US settlement wallet → EU settlement wallet, over the 24/7 Arc rail. The amount is the provably minimal top-up that keeps every mandatory obligation covered under the downside scenario.</p>
          <div className="grid">
            <div className="stat"><div className="l">Authoritative amount</div><div className="v big">{m.recommendation.amount}</div></div>
            <div className="stat"><div className="l">Max safe amount</div><div className="v">{m.recommendation.maxSafe}</div></div>
            <div className="stat"><div className="l">Optimizer status</div><div className="v good">{m.recommendation.status}</div></div>
            <div className="stat"><div className="l">Latest safe execution</div><div className="v small">{m.recommendation.latestSafe}</div></div>
          </div>
          <div className="callout warn"><strong>Binding constraint:</strong> {m.recommendation.binding}</div>
          <div className="callout"><strong>Consequence of inaction:</strong> {m.recommendation.consequence}</div>
        </section>

        {/* FORECAST */}
        <section className="card">
          <div className="card-eyebrow">Forecast · 48h operational</div>
          <h2>Where the EU wallet breaches, hour by hour</h2>
          <p className="sub">Downside scenario: Friday receivable delayed, outflows +5%. As of {m.asOf}. Earliest shortfall at <span className="mono">{m.forecast.shortfallAt}</span>.</p>
          <div className="grid" style={{ marginBottom: 18 }}>
            <div className="stat"><div className="l">Base min balance</div><div className="v good">{m.forecast.baseMin}</div></div>
            <div className="stat"><div className="l">Downside min balance</div><div className="v hot">{m.forecast.downMin}</div></div>
            <div className="stat"><div className="l">Required top-up</div><div className="v">{m.forecast.requiredTopUp}</div></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Value time</th><th>Projected closing</th><th>Reserve floor</th><th>Coverage</th></tr></thead>
              <tbody>
                {m.forecast.points.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.at}</td>
                    <td className={p.short ? "hot mono" : "mono"}>{p.closing}</td>
                    <td className="mono">{p.reserve}</td>
                    <td>{p.short ? <span className="pill fail">shortfall</span> : <span className="pill pass">covered</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* AI */}
        <section className="card">
          <div className="card-eyebrow">AI analyst</div>
          <h2>{m.ai.source === "claude" ? `Explained by Claude (${m.ai.model})` : "Deterministic explanation"}</h2>
          <p className="sub">
            {m.ai.source === "claude" ? "Generated from validated figures only." : "Runs with no API key; set ANTHROPIC_API_KEY to use the live model."} The model may explain — it cannot compute the amount, approve, or execute.
          </p>
          <div className="callout"><strong>{m.ai.headline}</strong></div>
          <div className="callout"><strong>What to do:</strong> {m.ai.whatToDo}</div>
          <div className="callout warn"><strong>Binding constraint:</strong> {m.ai.bindingConstraint}</div>
        </section>

        {/* POLICY */}
        <section className="card">
          <div className="card-eyebrow">Controls</div>
          <h2>Deterministic policy evaluation</h2>
          <p className="sub">Versioned, testable, independent of any language model. A failed mandatory rule makes the proposal non-approvable.</p>
          <div style={{ overflowX: "auto" }}>
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
          </div>
        </section>

        {/* CERTIFICATE */}
        <section className="card">
          <div className="card-eyebrow">Signature primitive</div>
          <h2>Settlement Coverage Certificate</h2>
          <p className="sub">Machine-verifiable proof the action keeps every mandatory obligation covered. Only the opaque commitment goes on-chain.</p>
          <div className="grid">
            <div className="stat"><div className="l">Certificate ID</div><div className="v small">{m.certificate.id}</div></div>
            <div className="stat"><div className="l">Base-case coverage</div><div className="v good">{m.certificate.baseCoverage}</div></div>
            <div className="stat"><div className="l">Stressed coverage</div><div className="v">{m.certificate.stressedCoverage}</div></div>
            <div className="stat"><div className="l">Valid until</div><div className="v small">{m.certificate.validUntil}</div></div>
          </div>
          <div className="stat" style={{ marginTop: 16, borderImage: "none", borderLeftColor: "var(--violet)" }}>
            <div className="l">Commitment · SHA-256, published on Arc as bytes32</div>
            <div className="v small">{m.certificate.commitment}</div>
          </div>
          <div className={`callout ${m.certificate.matchesChain ? "good" : "warn"}`}>Self-consistent and matches its on-chain commitment. Covers: {m.certificate.covered.join(", ")}.</div>
        </section>

        {/* SHADOW */}
        <section className="card">
          <div className="card-eyebrow">ROI · shadow mode</div>
          <h2>What dynamic funding releases vs a static buffer</h2>
          <p className="sub">Counterfactual against a static 3,000,000 USDC prefunding buffer. No money moves; every figure is computed from the dataset with the formula shown, and nothing is annualized.</p>
          <div className="grid" style={{ marginBottom: 16 }}>
            <div className="stat"><div className="l">Capital released</div><div className="v good">{m.shadow.capitalReleased}</div></div>
            <div className="stat"><div className="l">Prefunding reduction</div><div className="v">{m.shadow.reductionPct}%</div></div>
            <div className="stat"><div className="l">Shortfalls avoided</div><div className="v">{m.shadow.avoidedShortfalls}</div></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Metric</th><th>ArcTreasury</th><th>Static baseline</th><th>Unit</th></tr></thead>
              <tbody>
                {m.shadow.metrics.map((mm) => (
                  <tr key={mm.name}><td>{mm.name}</td><td className="mono">{mm.arc}</td><td className="mono">{mm.base}</td><td className="mono">{mm.unit}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SAFETY */}
        <section className="card danger">
          <div className="card-eyebrow">Safety gate</div>
          <h2>An unsafe larger release is blocked</h2>
          <p className="sub">Attempting to move more than policy permits.</p>
          <div className="grid">
            <div className="stat"><div className="l">Attempted release</div><div className="v hot">{m.blocked.amount}</div></div>
            <div className="stat"><div className="l">Verifier passed</div><div className="v">{m.blocked.verifierPassed ? <span className="good">yes</span> : <span className="hot">no</span>}</div></div>
            <div className="stat"><div className="l">Policy approvable</div><div className="v">{m.blocked.policyApprovable ? <span className="good">yes</span> : <span className="hot">no</span>}</div></div>
          </div>
          <div className="callout bad">The unsafe action cannot become approvable — it exceeds the per-transaction cap. Money cannot move.</div>
        </section>

        {/* LIFECYCLE */}
        <section className="card">
          <div className="card-eyebrow">Governance</div>
          <h2>Proposal lifecycle</h2>
          <p className="sub">Current state: <strong>{m.proposal.state}</strong>. Approved by {m.proposal.approver}. Every transition is an append-only, hash-chained audit event.</p>
          <div className="flow">
            {["draft", "evaluated", "awaiting_approval", "approved", "executing", "settled"].map((s, i, a) => (
              <span key={s} style={{ display: "contents" }}>
                <span className={`step ${m.proposal.lifecycle.includes(s) || s === "draft" ? "on" : ""}`}>{s.replace(/_/g, " ")}</span>
                {i < a.length - 1 && <span className="arrow">→</span>}
              </span>
            ))}
          </div>
        </section>

        <footer>
          Prototype and testnet software. Not investment advice, not production treasury infrastructure. All balances,
          obligations, and forecasts are synthetic demo data for the fictional company Northstar Pay. ArcTreasury is
          non-custodial decisioning and orchestration software; the smart-contract control perimeter governs only the
          ERC-20 balance it custodies and the permissions defined in it, and has no authority over external bank,
          custodian, or exchange accounts.
        </footer>
      </div>
    </>
  );
}
