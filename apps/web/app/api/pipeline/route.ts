import { NextResponse } from "next/server";
import { parseScenarioInput, toScenario } from "@arctreasury/domain";
import { computePipeline, type ScenarioChoice } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";

const ALLOWED: ScenarioChoice[] = ["downside", "severe", "base"];
const scen = (v: string | null): ScenarioChoice => (ALLOWED.includes(v as ScenarioChoice) ? (v as ScenarioChoice) : "downside");

/** GET: run the built-in Northstar fixture (demo). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.json(computePipeline(scen(url.searchParams.get("scenario"))));
}

/**
 * POST: run the engine over an ARBITRARY externally-supplied dataset. This is
 * how a different payment company's settlement position is evaluated without
 * any code change. Body: { dataset: ScenarioInput, scenario?, sourcePoolId?, destPoolId? }.
 */
export async function POST(req: Request) {
  let body: { dataset?: unknown; scenario?: string; sourcePoolId?: string; destPoolId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.dataset) return NextResponse.json({ error: "missing 'dataset'. GET /api/dataset/example for the schema shape." }, { status: 400 });

  let data;
  try {
    data = toScenario(parseScenarioInput(body.dataset));
  } catch (e) {
    const err = e as { issues?: unknown };
    return NextResponse.json({ error: "dataset failed validation", issues: err.issues ?? String(e) }, { status: 422 });
  }

  try {
    const result = computePipeline(scen(body.scenario ?? "downside"), {
      data,
      ...(body.sourcePoolId ? { sourcePoolId: body.sourcePoolId } : {}),
      ...(body.destPoolId ? { destPoolId: body.destPoolId } : {}),
      dataSource: "external (API-supplied)",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `engine error: ${(e as Error).message}` }, { status: 400 });
  }
}
