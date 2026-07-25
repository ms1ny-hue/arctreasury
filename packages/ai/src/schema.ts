/**
 * The explanation the model is allowed to produce. These are PROSE fields only.
 * The model never returns an amount, an approval, or an execution instruction;
 * the application keeps using the deterministic domain numbers for anything
 * authoritative. This schema is enforced via a forced tool call.
 */
export interface Explanation {
  headline: string;
  outlook: string;
  bindingConstraint: string;
  whatToDo: string;
  consequenceOfInaction: string;
  confidenceNote: string;
}

export interface ExplanationResult {
  source: "claude" | "deterministic";
  model?: string;
  explanation: Explanation;
  disclaimer: string;
}

export const EXPLANATION_TOOL = {
  name: "emit_treasury_explanation",
  description:
    "Return a short, plain-language explanation of a treasury liquidity recommendation. Use only the figures provided in the prompt; do not invent numbers, and do not restate an amount as authoritative. Prose only.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", description: "One sentence: what the desk should know first." },
      outlook: { type: "string", description: "2-3 sentences on the liquidity outlook and the shortfall." },
      bindingConstraint: { type: "string", description: "The single binding constraint, restated plainly." },
      whatToDo: { type: "string", description: "The recommended action in plain language (reference, do not recompute, the amount)." },
      consequenceOfInaction: { type: "string", description: "What happens if no action is taken." },
      confidenceNote: { type: "string", description: "A short, honest note on data freshness and scenario assumptions." },
    },
    required: ["headline", "outlook", "bindingConstraint", "whatToDo", "consequenceOfInaction", "confidenceNote"],
  },
} as const;

export const AI_DISCLAIMER =
  "AI-generated explanation. This is analysis of validated figures, not a source of truth. The recommended amount, policy result, and execution are computed and gated deterministically; the model cannot alter them, approve, or execute.";
