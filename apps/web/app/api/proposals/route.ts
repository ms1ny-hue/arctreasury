import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  northstarScenario, recommendRebalance, evaluatePolicy, verifyAction, buildCertificate,
  parseScenarioInput, toScenario, scenarioToInput, hashValue,
} from "@arctreasury/domain";
import { isConfigured, ensureOrg, ensureEnv, insertDataset, createProposal } from "@arctreasury/db";
import { ARC_TESTNET } from "@arctreasury/config";

export const dynamic = "force-dynamic";

const ORG = "demo-org";       // single-tenant demo; schema is multi-tenant
const ENV = "demo-env";

/**
 * Create and PERSIST a proposal from a dataset. The recommendation is computed
 * deterministically server-side; the browser cannot supply the amount, hashes,
 * or commitment — they are derived here and stored. Idempotent per dataset+route.
 */
export async function POST(req: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "persistence not configured (no DATABASE_URL)" }, { status: 503 });
  let body: { dataset?: unknown; sourcePoolId?: string; destPoolId?: string; nonce?: string | number };
  try { body = await req.json().catch(() => ({})); } catch { body = {}; }

  let data;
  try {
    data = body.dataset ? toScenario(parseScenarioInput(body.dataset)) : northstarScenario();
  } catch (e) {
    return NextResponse.json({ error: "dataset failed validation", issues: (e as { issues?: unknown }).issues ?? String(e) }, { status: 422 });
  }

  const sourcePoolId = body.sourcePoolId ?? data.pools[data.pools.length - 1]?.id ?? "pool-us";
  const destPoolId = body.destPoolId ?? data.pools[0]?.id ?? "pool-eu";
  const destPool = data.pools.find((p) => p.id === destPoolId);
  if (!destPool) return NextResponse.json({ error: "unknown destPoolId" }, { status: 400 });

  const rec = recommendRebalance(data, { sourcePoolId, destPoolId });
  const policyEval = evaluatePolicy(data, rec.action);
  const verification = verifyAction(data, rec.action);
  const simHash = hashValue({ sim: "api", action: rec.action, forecastHash: rec.forecastHash });
  const cert = buildCertificate(data, rec, policyEval, simHash);

  try {
    await ensureOrg(ORG, "Demo Org");
    await ensureEnv(ENV, ORG, "arc-testnet", ARC_TESTNET.chainId);
    const datasetId = await insertDataset({
      id: `ds-${rec.inputSnapshotHash.slice(2, 14)}`, orgId: ORG, envId: ENV, accountId: data.accountId,
      asOf: data.asOf, dataStatus: data.dataStatus, sourceSystem: body.dataset ? "api" : "fixture",
      snapshotHash: rec.inputSnapshotHash, payload: scenarioToInput(data),
    });
    // A nonce (e.g. per interactive run) yields a fresh proposal; without it the
    // create is idempotent per dataset+route.
    const nonceSuffix = body.nonce != null ? `:${String(body.nonce).slice(0, 40)}` : "";
    const idempotencyKey = `${ORG}:${rec.inputSnapshotHash}:${rec.forecastHash}:${destPoolId}${nonceSuffix}`;
    const proposal = await createProposal({
      id: `prop-${randomUUID()}`, orgId: ORG, envId: ENV, datasetId,
      sourcePool: sourcePoolId, destPool: destPoolId, destAddress: destPool.walletAddress,
      amountAtomic: rec.authoritativeAmount.amount.toString(), rail: rec.action.railId,
      policyHash: policyEval.resultHash, forecastHash: rec.forecastHash, inputHash: rec.inputSnapshotHash,
      certCommitment: cert.commitment, idempotencyKey,
    });

    return NextResponse.json({
      proposalId: proposal.id, state: proposal.state, dataSource: body.dataset ? "external (API-supplied)" : "fixture",
      recommendation: { amountAtomic: proposal.amount_atomic, rail: proposal.rail, destPool: destPoolId, approvable: policyEval.approvable && verification.passed },
      certificateCommitment: cert.commitment,
    }, { status: 201, headers: { Location: `/api/proposals/${proposal.id}` } });
  } catch (e) {
    return NextResponse.json({ error: `persist failed: ${(e as Error).message}` }, { status: 500 });
  }
}
