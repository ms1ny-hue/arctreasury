import { NextResponse } from "next/server";
import { northstarScenario, scenarioToInput } from "@arctreasury/domain";

export const dynamic = "force-dynamic";

/**
 * The Northstar fixture exported in the external ingestion format. Fetch it,
 * edit any field (balances, obligations, rail timing), and POST it back to
 * /api/pipeline to get a different recommendation. Proves the fixture is a
 * sample dataset, not baked into the engine.
 */
export async function GET() {
  return NextResponse.json(scenarioToInput(northstarScenario()));
}
