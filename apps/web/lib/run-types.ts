/**
 * Types for the /run client workflow.
 *
 * `Pipeline` is derived from the engine itself rather than restated by hand, so
 * the UI cannot drift from the computed shape.
 *
 * `ExecResult` is a discriminated union over what POST /api/execute actually
 * returns: a settled Arc testnet result, a demo/simulated result, or an error.
 * The route emits a bare `{ error }` on several paths with no `mode` field, so
 * the error arm is modelled explicitly instead of being inferred.
 */

import type { computePipeline } from "./pipeline";

export type Pipeline = ReturnType<typeof computePipeline>;

export interface ExecLeg {
  tx: string;
  url: string;
  status?: string;
  block?: number;
}

export interface ExecSettled {
  mode: "arc-testnet";
  proposalId?: string;
  note?: string;
  execute: ExecLeg;
  register?: Partial<ExecLeg>;
  approve?: Partial<ExecLeg>;
  executed?: boolean;
  commitmentMatches?: boolean;
  settledAmount?: string;
  signerProvider?: string;
  circleTransactionId?: string;
  circleTransactionState?: string;
}

export interface ExecDemo {
  mode: "demo";
  proposalId?: string;
  note?: string;
}

export interface ExecError {
  mode: "error";
  note: string;
}

export type ExecResult = ExecSettled | ExecDemo | ExecError;

export function isSettled(e: ExecResult | null): e is ExecSettled {
  return e?.mode === "arc-testnet";
}

export function isError(e: ExecResult | null): e is ExecError {
  return e?.mode === "error";
}

/**
 * Normalise any /api/execute response into ExecResult. The route returns a
 * bare `{ error }` (no `mode`) on validation, conflict, and failure paths;
 * without this the old UI fell through to the "Demo settlement" branch and
 * rendered an empty note.
 */
export function toExecResult(raw: unknown): ExecResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.error === "string") return { mode: "error", note: o.error };
  if (o.mode === "arc-testnet") return o as unknown as ExecSettled;
  if (typeof o.mode === "string") return o as unknown as ExecDemo;
  return { mode: "error", note: "unrecognised response from /api/execute" };
}

export interface VerifyResult {
  integrity: { matches: boolean; recomputed: string };
  onchain?: { matchesBundle: boolean } | null;
  establishes: string;
  doesNotEstablish: string;
}
