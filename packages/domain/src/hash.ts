import { createHash } from "node:crypto";

/**
 * Canonical JSON + hashing.
 *
 * HASH CHOICE (documented once, used consistently):
 *   - All offchain integrity hashes (input snapshot, forecast, route,
 *     simulation, policy-evaluation result, and the certificate commitment)
 *     use SHA-256 over canonical JSON, rendered as a 0x-prefixed 32-byte hex.
 *   - The certificate commitment is published onchain as a `bytes32`. The
 *     contract only STORES and EMITS it; it never recomputes it. Independent
 *     verification recomputes SHA-256 over the private canonical certificate
 *     and compares to the onchain bytes32. No treasury data is revealed.
 *
 * Canonicalization: object keys sorted recursively; bigint serialized as a
 * decimal string tagged so it round-trips deterministically; undefined
 * dropped. This guarantees identical inputs => identical hash on any machine.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (typeof v === "bigint") return { __bigint__: v.toString() };
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[key];
      if (val === undefined) continue;
      out[key] = sortValue(val);
    }
    return out;
  }
  return v;
}

export function sha256Hex(input: string): string {
  return "0x" + createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash any structured value via canonical JSON + SHA-256. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
