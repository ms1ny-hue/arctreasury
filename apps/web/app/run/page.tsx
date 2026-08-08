"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { InfoTip, TooltipProvider } from "../../components/ui/tooltip";
import { Disclosure } from "../../components/ui/collapsible";
import { ApprovalCheckbox } from "../../components/ui/checkbox";
import { Alert, LiveRegion } from "../../components/ui/alert";
import { Toaster, toast } from "../../components/ui/toaster";
import {
  isError,
  isSettled,
  toExecResult,
  type ExecResult,
  type Pipeline,
  type VerifyResult,
} from "../../lib/run-types";

const STEPS = ["Detect", "Recommend", "Verify", "Approve", "Settle", "Audit"] as const;

interface ScenarioChoice {
  value: string;
  label: string;
}

/**
 * Native <select> is kept deliberately. A Radix Select cost 14 kB of first-load
 * JS for a three-option picker, and the native control has better touch
 * behaviour on mobile. The styling hook (.scenario) already matches the skin.
 */
const SCENARIOS: readonly ScenarioChoice[] = [
  { value: "downside", label: "Downside — delayed receivable, +5% outflows" },
  { value: "severe", label: "Severe — larger delays and outflows" },
  { value: "base", label: "Base — no stress" },
];

/** Plain-language definitions for the treasury terms on this page. */
const GLOSSARY = {
  binding:
    "The single constraint that determines the answer. Relaxing anything else changes nothing until this one moves.",
  sizing:
    "How the amount was derived. The engine funds the smallest amount that clears the shortfall, not a round number.",
  latestSafe:
    "The last moment execution can start and still arrive before the shortfall. Miss it and the rail no longer helps.",
  commitment:
    "A hash of the evidence bundle written on-chain at execution. If the bundle is altered afterwards, the hashes stop matching.",
  arrival:
    "When funds are expected to land using the conservative estimate for this rail, not the optimistic one.",
} as const;

export default function Run() {
  const [scenario, setScenario] = useState("downside");
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const [reveal, setReveal] = useState(0); // how many steps revealed
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [exec, setExec] = useState<ExecResult | null>(null);
  const [verifyRes, setVerifyRes] = useState<VerifyResult | null>(null);
  const [announce, setAnnounce] = useState("");

  // Focus management: each revealed step is focusable, and focus follows the
  // reveal so keyboard and screen-reader users land on the new content instead
  // of being stranded on a button that just disappeared.
  const stepRefs = useRef<Record<number, HTMLElement | null>>({});
  const prevReveal = useRef(0);
  const settleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (reveal > prevReveal.current && reveal > 1) stepRefs.current[reveal]?.focus();
    prevReveal.current = reveal;
  }, [reveal]);

  useEffect(() => {
    if (exec) settleRef.current?.focus();
  }, [exec]);

  const setStepRef = useCallback(
    (step: number) => (el: HTMLElement | null) => {
      stepRefs.current[step] = el;
    },
    []
  );

  async function detect() {
    setLoading("detect");
    setAnnounce("Running the engine to detect a shortfall.");
    setExec(null);
    setVerifyRes(null);
    setApproved(false);
    try {
      const r: Pipeline = await fetch(`/api/pipeline?scenario=${scenario}`).then((x) => x.json());
      setPipe(r);
      setReveal(1);
      setAnnounce(
        r.forecast.shortfallAt
          ? `Shortfall detected. Required top-up ${r.forecast.requiredTopUp}.`
          : "No shortfall detected for this scenario."
      );
    } catch (e) {
      setAnnounce("Detection failed.");
      toast.error("Could not run the engine", { description: (e as Error).message });
    }
    setLoading(null);
  }

  async function settle() {
    setLoading("settle");
    setAnnounce("Settling on Arc Testnet. This can take up to a minute.");
    try {
      // Persist a fresh proposal, record the human approval server-side, then
      // execute through the configured signer (Circle in production).
      const created = await fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario, nonce: `run-${Date.now()}` }),
      }).then((x) => x.json());
      const id = created.proposalId;
      if (!id) {
        const note = created.error ?? "could not create proposal";
        setExec({ mode: "error", note });
        setAnnounce(`Settlement failed: ${note}`);
        setReveal(6);
        setLoading(null);
        return;
      }
      await fetch(`/api/proposals/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approver: "treasury-director" }),
      });
      const raw = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId: id }),
      }).then((x) => x.json());
      const result = toExecResult(raw);
      setExec(result);
      setAnnounce(
        isSettled(result)
          ? `Settled on Arc Testnet. Transaction ${result.execute.tx.slice(0, 12)}.`
          : isError(result)
            ? `Settlement failed: ${result.note}`
            : "Demo settlement complete."
      );
    } catch (e) {
      const note = (e as Error).message;
      setExec({ mode: "error", note });
      setAnnounce(`Settlement failed: ${note}`);
    }
    setReveal(6);
    setLoading(null);
  }

  async function verifyEvidence() {
    if (!pipe) return;
    setLoading("verify");
    setAnnounce("Verifying the evidence bundle.");
    try {
      const r: VerifyResult = await fetch("/api/verify-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evidence: pipe.evidence,
          proposalId: isSettled(exec) ? exec.proposalId : undefined,
        }),
      }).then((x) => x.json());
      setVerifyRes(r);
      setAnnounce(
        r.integrity.matches
          ? "Integrity check passed. The recomputed commitment matches."
          : "Integrity check failed. The recomputed commitment does not match."
      );
      if (r.integrity.matches) toast.success("Integrity verified");
      else toast.error("Integrity check failed");
    } catch (e) {
      setAnnounce("Verification failed.");
      toast.error("Verification failed", { description: (e as Error).message });
    }
    setLoading(null);
  }

  function download() {
    if (!pipe) return;
    const bundle = isSettled(exec)
      ? { ...pipe.evidence, tx: exec.execute.tx, proposalId: exec.proposalId ?? null }
      : pipe.evidence;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "arctreasury-evidence.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("evidence.json downloaded");
  }

  const activeStep = exec ? (isSettled(exec) ? 6 : 5) : approved ? 4 : reveal;
  const evidenceLines = pipe ? JSON.stringify(pipe.evidence, null, 2).split("\n").length : 0;

  return (
    <TooltipProvider delayDuration={120}>
      <Toaster />
      <LiveRegion message={announce} />

      <nav className="top">
        <div className="nav-in">
          <div className="wordmark">
            <span className="dot" />
            ArcTreasury
          </div>
          <div className="nav-right">
            <a className="nav-link" href="/">
              ← Overview
            </a>
            <a
              className="nav-link"
              href="https://github.com/ms1ny-hue/arctreasury"
              target="_blank"
              rel="noreferrer"
            >
              Repo ↗
            </a>
          </div>
        </div>
      </nav>

      <div className="shell">
        <header className="hero" style={{ paddingBottom: 8 }}>
          <span className="eyebrow">Interactive workflow · live on Arc Testnet</span>
          <h1 style={{ fontSize: "clamp(2rem,1.2rem+3vw,3.4rem)" }}>
            Run the decision loop <span className="grad">end to end.</span>
          </h1>
          <p className="lede">
            Pick a stress scenario and step through Detect → Recommend → Verify → Approve → Settle →
            Audit. The deterministic engine runs on each click; the Settle step executes a real,
            scaled-down USDC movement through the deployed contract on Arc Testnet.
          </p>

          {/* role="list" is required: `list-style: none` strips list semantics
              from the a11y tree in WebKit and is inconsistent elsewhere. */}
          <ol className="stepper" role="list" aria-label="Workflow progress">
            {STEPS.map((s, i) => {
              const state = activeStep > i ? "done" : activeStep === i ? "active" : "";
              return (
                <li
                  key={s}
                  className={`s ${state}`}
                  {...(activeStep === i ? { "aria-current": "step" as const } : {})}
                >
                  {i + 1} {s}
                  {state === "done" ? <span className="sr-only"> (complete)</span> : null}
                </li>
              );
            })}
          </ol>

          <div className="actions">
            <select
              className="scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              disabled={loading === "detect"}
              aria-label="Stress scenario"
            >
              {SCENARIOS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button className="btn" onClick={detect} disabled={loading === "detect"}>
              {loading === "detect" ? (
                <>
                  <span className="spin" />
                  <span className="sr-only">Detecting shortfall</span>
                </>
              ) : (
                "1 · Detect shortfall"
              )}
            </button>
          </div>
        </header>

        {pipe && (
          <>
            {/* DETECT */}
            <section className="card" tabIndex={-1} ref={setStepRef(1)} aria-labelledby="h-detect">
              <div className="card-eyebrow">1 · Detect</div>
              <h2 id="h-detect">Forecast &amp; shortfall</h2>
              <div className="grid">
                <div className="stat">
                  <div className="l">Scenario</div>
                  <div className="v small">{pipe.scenario}</div>
                </div>
                <div className="stat">
                  <div className="l">EU min balance</div>
                  <div className={`v ${pipe.forecast.shortfallAt ? "hot" : "good"}`}>
                    {pipe.forecast.minBalance}
                  </div>
                </div>
                <div className="stat">
                  <div className="l">Earliest shortfall</div>
                  <div className="v small">{pipe.forecast.shortfallAt ?? "none"}</div>
                </div>
                <div className="stat">
                  <div className="l">Required top-up</div>
                  <div className="v">{pipe.forecast.requiredTopUp}</div>
                </div>
              </div>
              {reveal < 2 && (
                <div className="actions">
                  <button className="btn" onClick={() => setReveal(2)}>
                    2 · Recommend action →
                  </button>
                </div>
              )}
            </section>

            {/* RECOMMEND */}
            {reveal >= 2 && (
              <section className="card" tabIndex={-1} ref={setStepRef(2)} aria-labelledby="h-rec">
                <div className="card-eyebrow">2 · Recommend</div>
                <h2 id="h-rec">Smallest safe funding action</h2>
                <div className="grid">
                  <div className="stat">
                    <div className="l">Authoritative amount</div>
                    <div className="v big">{pipe.recommendation.amount}</div>
                  </div>
                  <div className="stat">
                    <div className="l">
                      <InfoTip label="Sizing method">{GLOSSARY.sizing}</InfoTip>
                    </div>
                    <div className="v small good">{pipe.recommendation.sizingMethod}</div>
                  </div>
                  <div className="stat">
                    <div className="l">
                      <InfoTip label="Conservative arrival">{GLOSSARY.arrival}</InfoTip>
                    </div>
                    <div className="v small">{pipe.recommendation.arrivalAt}</div>
                  </div>
                  <div className="stat">
                    <div className="l">
                      <InfoTip label="Latest safe execution">{GLOSSARY.latestSafe}</InfoTip>
                    </div>
                    <div className="v small">{pipe.recommendation.latestSafe}</div>
                  </div>
                </div>
                <div className="callout warn">
                  <strong>
                    <InfoTip label="Binding constraint">{GLOSSARY.binding}</InfoTip>:
                  </strong>{" "}
                  {pipe.recommendation.binding}
                </div>
                {reveal < 3 && (
                  <div className="actions">
                    <button className="btn" onClick={() => setReveal(3)}>
                      3 · Independently verify →
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* VERIFY */}
            {reveal >= 3 && (
              <section className="card" tabIndex={-1} ref={setStepRef(3)} aria-labelledby="h-ver">
                <div className="card-eyebrow">3 · Verify</div>
                <h2 id="h-ver">
                  Independent verification{" "}
                  {pipe.verification.passed ? (
                    <span className="good">· passed ✓</span>
                  ) : (
                    <span className="hot">· failed</span>
                  )}
                </h2>
                <p className="sub">
                  Recomputed from raw inputs, including arrival timing — trusts none of the numbers
                  above.
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <caption className="sr-only">
                      Independent verification checks, with detail and pass or fail result for each.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Check</th>
                        <th scope="col">Detail</th>
                        <th scope="col">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipe.verification.checks.map((c) => (
                        <tr key={c.name}>
                          <td className="mono">{c.name}</td>
                          <td className="mono" style={{ color: "var(--faint)" }}>
                            {c.detail}
                          </td>
                          <td>
                            <span className={`pill ${c.ok ? "pass" : "fail"}`}>
                              {c.ok ? "pass" : "fail"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reveal < 4 && pipe.verification.passed && pipe.policy.approvable && (
                  <div className="actions">
                    <button className="btn" onClick={() => setReveal(4)}>
                      4 · Human approval →
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* APPROVE */}
            {reveal >= 4 && (
              <section className="card" tabIndex={-1} ref={setStepRef(4)} aria-labelledby="h-app">
                <div className="card-eyebrow">4 · Approve</div>
                <h2 id="h-app">Human approval</h2>
                <p className="sub">
                  Nothing executes until an explicit approval is recorded. Review the binding
                  constraint and consequence of inaction, then approve. Approval is persisted
                  server-side (not an authenticated named approver in this demo; production RBAC is
                  post-hackathon).
                </p>
                <div className="callout">
                  <strong>Consequence of inaction:</strong> {pipe.recommendation.consequence}
                </div>
                <ApprovalCheckbox
                  id="approve-gate"
                  checked={approved}
                  onCheckedChange={setApproved}
                  disabled={loading === "settle"}
                >
                  I approve this proposal for execution on Arc Testnet
                </ApprovalCheckbox>
                <div className="actions">
                  <button
                    className="btn ok"
                    onClick={settle}
                    disabled={!approved || loading === "settle"}
                  >
                    {loading === "settle" ? (
                      <>
                        <span className="spin" /> Settling on Arc…
                      </>
                    ) : (
                      "5 · Settle on Arc Testnet"
                    )}
                  </button>
                </div>
              </section>
            )}

            {/* SETTLE result */}
            {exec && (
              <section
                className={`card ${isSettled(exec) ? "live-card" : isError(exec) ? "danger" : ""}`}
                tabIndex={-1}
                ref={settleRef}
                aria-labelledby="h-set"
              >
                <div className="card-eyebrow">
                  5 · Settle{" "}
                  {isSettled(exec) ? (
                    <span className="prov live">Live tx</span>
                  ) : isError(exec) ? (
                    <span className="prov sim">Failed</span>
                  ) : (
                    <span className="prov sim">Demo</span>
                  )}
                </div>
                <h2 id="h-set">
                  {isSettled(exec)
                    ? "Settled on Arc Testnet"
                    : isError(exec)
                      ? "Settlement did not complete"
                      : "Demo settlement"}
                </h2>

                {isError(exec) ? (
                  <Alert tone="error" title="Execution failed.">
                    {exec.note.replace(/\.?\s*$/, ".")} Nothing was settled on-chain. The proposal
                    remains unexecuted and can be retried.
                  </Alert>
                ) : (
                  <p className="sub">{exec.note}</p>
                )}

                {isSettled(exec) && (
                  <div className="grid">
                    <div className="stat">
                      <div className="l">Execute tx</div>
                      <div className="v small">
                        <a href={exec.execute.url} target="_blank" rel="noreferrer">
                          {exec.execute.tx.slice(0, 20)}…
                        </a>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="l">Status · block</div>
                      <div className="v small">
                        <span className="good">{exec.execute.status}</span> · {exec.execute.block}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="l">On-chain executed</div>
                      <div className="v">
                        {exec.executed ? (
                          <span className="good">true ✓</span>
                        ) : (
                          <span className="hot">false</span>
                        )}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="l">
                        <InfoTip label="Commitment matches">{GLOSSARY.commitment}</InfoTip>
                      </div>
                      <div className="v">
                        {exec.commitmentMatches ? (
                          <span className="good">verified ✓</span>
                        ) : (
                          <span className="hot">no</span>
                        )}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="l">Settled amount</div>
                      <div className="v small">{exec.settledAmount}</div>
                    </div>
                    <div className="stat">
                      <div className="l">Register / approve</div>
                      <div className="v small">
                        {exec.register?.url ? (
                          <a href={exec.register.url} target="_blank" rel="noreferrer">
                            reg
                          </a>
                        ) : (
                          "reg"
                        )}{" "}
                        ·{" "}
                        {exec.approve?.url ? (
                          <a href={exec.approve.url} target="_blank" rel="noreferrer">
                            appr
                          </a>
                        ) : (
                          "appr"
                        )}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="l">Signed by</div>
                      <div className="v small">
                        {exec.signerProvider === "circle" ? "Circle wallet ✓" : exec.signerProvider}
                      </div>
                    </div>
                    {exec.circleTransactionId && (
                      <div className="stat">
                        <div className="l">Circle tx · state</div>
                        <div className="v small">
                          {String(exec.circleTransactionId).slice(0, 12)}… ·{" "}
                          {exec.circleTransactionState}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* AUDIT */}
            {reveal >= 4 && (
              <section className="card" tabIndex={-1} ref={setStepRef(6)} aria-labelledby="h-aud">
                <div className="card-eyebrow">6 · Audit</div>
                <h2 id="h-aud">Evidence bundle</h2>
                <p className="sub">
                  A canonical, tamper-evident record. Download it, then verify its integrity
                  commitment (and, after settling, the contract&apos;s on-chain commitment).
                </p>
                <div className="actions">
                  <button className="btn ghost" onClick={download}>
                    Download evidence.json
                  </button>
                  <button
                    className="btn ghost"
                    onClick={verifyEvidence}
                    disabled={loading === "verify"}
                  >
                    {loading === "verify" ? (
                      <>
                        <span className="spin" />
                        <span className="sr-only">Verifying evidence</span>
                      </>
                    ) : (
                      "Verify evidence"
                    )}
                  </button>
                </div>
                {verifyRes && (
                  <>
                    <div
                      className={`callout ${verifyRes.integrity.matches ? "good" : "bad"}`}
                      role="status"
                    >
                      Integrity: recomputed commitment{" "}
                      {verifyRes.integrity.matches ? "matches ✓" : "does NOT match ✗"} (
                      {verifyRes.integrity.recomputed.slice(0, 20)}…)
                      {verifyRes.onchain
                        ? ` · on-chain commitment ${verifyRes.onchain.matchesBundle ? "matches ✓" : "differs"}`
                        : ""}
                    </div>
                    <div className="callout">
                      <strong>Establishes:</strong> {verifyRes.establishes}
                    </div>
                    <div className="callout warn">
                      <strong>Does not establish:</strong> {verifyRes.doesNotEstablish}
                    </div>
                  </>
                )}
                <Disclosure label="Show evidence JSON" hint={`${evidenceLines} lines`}>
                  <pre className="bundle">{JSON.stringify(pipe.evidence, null, 2)}</pre>
                </Disclosure>
              </section>
            )}
          </>
        )}

        <footer>
          Prototype and testnet software. Not investment advice. Business amounts are simulated
          (Northstar Pay); on-chain execution is a scaled-down 0.05 USDC transfer on Arc Testnet for
          safety. Human approval is enforced server-side through a persistent, concurrency-safe
          workflow; a Circle developer-controlled wallet (Arc Testnet) mechanically records approval
          and executes settlement on-chain. The deployed application holds no raw private key.
          Approval and execution are not signer-separated on-chain.
        </footer>
      </div>
    </TooltipProvider>
  );
}
