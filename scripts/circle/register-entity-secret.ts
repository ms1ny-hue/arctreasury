/**
 * One-time: register your entity secret with Circle and save the recovery file.
 * Run in YOUR terminal (it reads CIRCLE_* from your local env).
 *
 *   openssl rand -hex 32            # -> put in .env as CIRCLE_ENTITY_SECRET
 *   set -a; . ./.env; set +a
 *   pnpm tsx scripts/circle/register-entity-secret.ts
 *
 * Never prints the secret. Saves the recovery file under ./circle-recovery —
 * store it somewhere safe and SEPARATE from the entity secret. It is the only
 * recovery mechanism if the entity secret is lost.
 */
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY ?? "";
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? "";
  if (!apiKey || !entitySecret) {
    console.error("Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in your env first (source .env). Nothing was sent.");
    process.exit(1);
  }
  await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: "./circle-recovery" });
  console.log("Entity secret registered. Recovery file saved under ./circle-recovery/ — move it somewhere safe and separate.");
  console.log("Next: pnpm tsx scripts/circle/register-wallet.ts");
}
main().catch((e) => { console.error("failed:", (e as Error).message.split("\n")[0]); process.exit(1); });
