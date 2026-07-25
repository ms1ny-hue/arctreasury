import { z } from "zod";

/**
 * Typed, validated environment. Fail fast at startup with clear messages.
 * `demo` mode requires no secrets; `arc-testnet` mode requires the deployed
 * contract address (and, for writes, a signer supplied out-of-band).
 */
const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x 20-byte address");

const Base = z.object({
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_EXPLORER_URL: z.string().url().default("https://testnet.arcscan.app"),
  ARC_USDC_ADDRESS: AddressSchema.default(
    "0x3600000000000000000000000000000000000000"
  ),
  CHAIN_MODE: z.enum(["demo", "arc-testnet"]).default("demo"),
  TREASURY_EXECUTOR_ADDRESS: AddressSchema.optional(),
  DEMO_VAULT_ADDRESS: AddressSchema.optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  FRESHNESS_BALANCE_MAX_AGE: z.coerce.number().int().positive().default(300),
  FRESHNESS_FORECAST_MAX_AGE: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof Base>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = Base.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.CHAIN_MODE === "arc-testnet" && !env.TREASURY_EXECUTOR_ADDRESS) {
    throw new Error(
      "CHAIN_MODE=arc-testnet requires TREASURY_EXECUTOR_ADDRESS. Deploy the contract first (pnpm contracts:deploy) or set CHAIN_MODE=demo."
    );
  }
  return env;
}
