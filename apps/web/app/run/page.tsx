"use client";
import { useState } from "react";

type Pipe = any;
type Exec = any;

const STEPS = ["Detect", "Recommend", "Verify", "Approve", "Settle", "Audit"];

export default function Run() {
  const [scenario, setScenario] = useState("downside");
  const [pipe, setPipe] = useState<Pipe | null>(null);
  const [reveal, setReveal] = useState(0); // how many steps revealed
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [exec, setExec] = useState<Exec | null>(null);
  const [verifyRes, setVerifyRes] = useState<any>(null);

  async function detect() {
    setLoading("detect"); setExec(null); setVerifyRes(null); setApproved(false);
    const r = await fetch(`/api/pipeline?scenario=${scenario}`).then((x) => x.json());
    setPipe(r); setReveal(1); setLoading(null);
  }
  async function settle() {
    setLoading("settle");
    try {
      // Persist a fresh proposal, record the human approval server-side, then
      // execute through the configured signer (Circle in production).
      const created = await fetch("/api/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario, nonce: `run-${Date.now()}` }) }).then((x) => x.json());
      const id = created.proposalId;
      if (!id) { setExec({ mode: "error", note: created.error ?? "could not create proposal" }); setReveal(6); setLoading(null); return; }
      await fetch(`/api/proposals/${id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approver: "treasury-director" }) });
      const r = await fetch("/api/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: id }) }).then((x) => x.json());
      setExec(r);
    } catch (e) {
      setExec({ mode: "error", note: (e as Error).message });
    }
    setReveal(6); setLoading(null);
  }
  async function verifyEvidence() {
    if (!pipe) return;
    setLoading("verify");
    const r = await fetch("/api/verify-evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidence: pipe.evidence, proposalId: exec?.proposalId }) }).then((x) => x.json());
    setVerifyRes(r); setLoading(null);
  }
  function download() {
    if (!pipe) return;
    const bundle = exec ? { ...pipe.evidence, tx: exec?.execute?.tx ?? null, proposalId: exec?.proposalId ?? null } : pipe.evidence;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "arctreasury-evidence.json"; a.click();
  }

  const activeStep = exec ? (exec.mode === "arc-testnet" ? 6 : 5) : approved ? 4 : reveal;

  return (
    <>
      <nav className="top"><div className="nav-in">
        <div className="wordmark"><span className="dot" />ArcTreasury</div>
        <div className="nav-right"><a className="nav-link" href="/">← Overview</a><a className="nav-link" href="https://github.com/ms1ny-hue/arctreasury" target="_blank" rel="noreferrer">Repo ↗</a></div>
      </div></nav>

      <div className="shell">
        <header className="hero" style={{ paddingBottom: 8 }}>
          <span className="eyebrow">Interactive workflow · live on Arc Testnet</span>
          <h1 style={{ fontSize: "clamp(2rem,1.2rem+3vw,3.4rem)" }}>Run the decision loop <span className="grad">end to end.</span></h1>
          <p className="lede">Pick a stress scenario and step through Detect → Recommend → Verify → Approve → Settle → Audit. The deterministic engine runs on each click; the Settle step executes a real, scaled-down USDC movement through the deployed contract on Arc Testnet.</p>
          <div className="stepper">
            {STEPS.map((s, i) => <span key={s} className={`s ${activeStep > i ? "done" : activeStep === i ? "active" : ""}`}>{i + 1} {s}</span>)}
          </div>
          <div className="actions">
            <select className="scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              <option value="downside">Downside — delayed receivable, +5% outflows</option>
              <option value="severe">Severe — larger delays and outflows</option>
              <option value="base">Base — no stress</option>
            </select>
            <button className="btn" onClick={detect} disabled={loading === "detect"}>{loading === "detect" ? <span className="spin" /> : "1 · Detect shortfall"}</button>
          </div>
        </header>

        {pipe && (
          <>
            {/* DETECT */}
            <section className="card">
              <div className="card-eyebrow">1 · Detect</div>
              <h2>Forecast &amp; shortfall</h2>
              <div className="grid">
                <div className="stat"><div className="l">Scenario</div><div className="v small">{pipe.scenario}</div></div>
                <div className="stat"><div className="l">EU min balance</div><div className={`v ${pipe.forecast.shortfallAt ? "hot" : "good"}`}>{pipe.forecast.minBalance}</div></div>
                <div className="stat"><div className="l">Earliest shortfall</div><div className="v small">{pipe.forecast.shortfallAt ?? "none"}</div></div>
                <div className="stat"><div className="l">Required top-up</div><div className="v">{pipe.forecast.requiredTopUp}</div></div>
              </div>
              {reveal < 2 && <div className="actions"><button className="btn" onClick={() => setReveal(2)}>2 · Recommend action →</button></div>}
            </section>

            {/* RECOMMEND */}
            {reveal >= 2 && (
              <section className="card">
                <div className="card-eyebrow">2 · Recommend</div>
                <h2>Smallest safe funding action</h2>
                <div className="grid">
                  <div className="stat"><div className="l">Authoritative amount</div><div className="v big">{pipe.recommendation.amount}</div></div>
                  <div className="stat"><div className="l">Sizing method</div><div className="v small good">{pipe.recommendation.sizingMethod}</div></div>
                  <div className="stat"><div className="l">Conservative arrival</div><div className="v small">{pipe.recommendation.arrivalAt}</div></div>
                  <div className="stat"><div className="l">Latest safe execution</div><div className="v small">{pipe.recommendation.latestSafe}</div></div>
                </div>
                <div className="callout warn"><strong>Binding constraint:</strong> {pipe.recommendation.binding}</div>
                {reveal < 3 && <div className="actions"><button className="btn" onClick={() => setReveal(3)}>3 · Independently verify →</button></div>}
              </section>
            )}

            {/* VERIFY */}
            {reveal >= 3 && (
              <section className="card">
                <div className="card-eyebrow">3 · Verify</div>
                <h2>Independent verification {pipe.verification.passed ? <span className="good">· passed ✓</span> : <span className="hot">· failed</span>}</h2>
                <p className="sub">Recomputed from raw inputs, including arrival timing — trusts none of the numbers above.</p>
                <div style={{ overflowX: "auto" }}>
                  <table><thead><tr><th>Check</th><th>Detail</th><th>Result</th></tr></thead><tbody>
                    {pipe.verification.checks.map((c: any) => (
                      <tr key={c.name}><td className="mono">{c.name}</td><td className="mono" style={{ color: "var(--faint)" }}>{c.detail}</td><td><span className={`pill ${c.ok ? "pass" : "fail"}`}>{c.ok ? "pass" : "fail"}</span></td></tr>
                    ))}
                  </tbody></table>
                </div>
                {reveal < 4 && pipe.verification.passed && pipe.policy.approvable && <div className="actions"><button className="btn" onClick={() => setReveal(4)}>4 · Human approval →</button></div>}
              </section>
            )}

            {/* APPROVE */}
            {reveal >= 4 && (
              <section className="card">
                <div className="card-eyebrow">4 · Approve</div>
                <h2>Human approval</h2>
                <p className="sub">Nothing executes until a person approves. Review the binding constraint and consequence of inaction, then approve.</p>
                <div className="callout"><strong>Consequence of inaction:</strong> {pipe.recommendation.consequence}</div>
                <div className="actions">
                  <label className="appr"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> I approve this proposal for execution on Arc Testnet</label>
                </div>
                <div className="actions">
                  <button className="btn ok" onClick={settle} disabled={!approved || loading === "settle"}>{loading === "settle" ? <><span className="spin" /> Settling on Arc…</> : "5 · Settle on Arc Testnet"}</button>
                </div>
              </section>
            )}

            {/* SETTLE result */}
            {exec && (
              <section className="card live-card">
                <div className="card-eyebrow">5 · Settle {exec.mode === "arc-testnet" ? <span className="prov live">Live tx</span> : <span className="prov sim">Demo</span>}</div>
                <h2>{exec.mode === "arc-testnet" ? "Settled on Arc Testnet" : "Demo settlement"}</h2>
                <p className="sub">{exec.note}</p>
                {exec.mode === "arc-testnet" && (
                  <div className="grid">
                    <div className="stat"><div className="l">Execute tx</div><div className="v small"><a href={exec.execute.url} target="_blank" rel="noreferrer">{exec.execute.tx.slice(0, 20)}…</a></div></div>
                    <div className="stat"><div className="l">Status · block</div><div className="v small"><span className="good">{exec.execute.status}</span> · {exec.execute.block}</div></div>
                    <div className="stat"><div className="l">On-chain executed</div><div className="v">{exec.executed ? <span className="good">true ✓</span> : <span className="hot">false</span>}</div></div>
                    <div className="stat"><div className="l">Commitment matches</div><div className="v">{exec.commitmentMatches ? <span className="good">verified ✓</span> : <span className="hot">no</span>}</div></div>
                    <div className="stat"><div className="l">Settled amount</div><div className="v small">{exec.settledAmount}</div></div>
                    <div className="stat"><div className="l">Register / approve</div><div className="v small">{exec.register?.url ? <a href={exec.register.url} target="_blank" rel="noreferrer">reg</a> : "reg"} · {exec.approve?.url ? <a href={exec.approve.url} target="_blank" rel="noreferrer">appr</a> : "appr"}</div></div>
                    <div className="stat"><div className="l">Signed by</div><div className="v small">{exec.signerProvider === "circle" ? "Circle wallet ✓" : exec.signerProvider}</div></div>
                    {exec.circleTransactionId && <div className="stat"><div className="l">Circle tx · state</div><div className="v small">{String(exec.circleTransactionId).slice(0, 12)}… · {exec.circleTransactionState}</div></div>}
                  </div>
                )}
              </section>
            )}

            {/* AUDIT */}
            {(reveal >= 4) && (
              <section className="card">
                <div className="card-eyebrow">6 · Audit</div>
                <h2>Evidence bundle</h2>
                <p className="sub">A canonical, tamper-evident record. Download it, then verify its integrity commitment (and, after settling, the contract&apos;s on-chain commitment).</p>
                <div className="actions">
                  <button className="btn ghost" onClick={download}>Download evidence.json</button>
                  <button className="btn ghost" onClick={verifyEvidence} disabled={loading === "verify"}>{loading === "verify" ? <span className="spin" /> : "Verify evidence"}</button>
                </div>
                {verifyRes && (
                  <>
                    <div className={`callout ${verifyRes.integrity.matches ? "good" : "bad"}`}>Integrity: recomputed commitment {verifyRes.integrity.matches ? "matches ✓" : "does NOT match ✗"} ({verifyRes.integrity.recomputed.slice(0, 20)}…){verifyRes.onchain ? ` · on-chain commitment ${verifyRes.onchain.matchesBundle ? "matches ✓" : "differs"}` : ""}</div>
                    <div className="callout"><strong>Establishes:</strong> {verifyRes.establishes}</div>
                    <div className="callout warn"><strong>Does not establish:</strong> {verifyRes.doesNotEstablish}</div>
                  </>
                )}
                <pre className="bundle">{JSON.stringify(pipe.evidence, null, 2)}</pre>
              </section>
            )}
          </>
        )}

        <footer>Prototype and testnet software. Not investment advice. Business amounts are simulated (Northstar Pay); on-chain execution is a scaled-down 0.05 USDC transfer on Arc Testnet for safety. Human approval is enforced server-side through a persistent, concurrency-safe workflow; a Circle developer-controlled wallet (Arc Testnet) mechanically records approval and executes settlement on-chain. The deployed application holds no raw private key. Approval and execution are not signer-separated on-chain.</footer>
      </div>
    </>
  );
}
