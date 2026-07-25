import { NextResponse } from "next/server";
import { computePipeline, type ScenarioChoice } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";

const ALLOWED: ScenarioChoice[] = ["downside", "severe", "base"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("scenario") ?? "downside") as ScenarioChoice;
  const scenario = ALLOWED.includes(raw) ? raw : "downside";
  return NextResponse.json(computePipeline(scenario));
}
