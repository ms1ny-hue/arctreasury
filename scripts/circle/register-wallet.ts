/**
 * One-time Circle developer-controlled wallet provisioning for Arc Testnet.
 *
 * Run locally after you create a Circle developer account and generate an entity
 * secret in the Circle console. Requires in the environment (never committed):
 *   CIRCLE_API_KEY          — from the Circle console
 *   CIRCLE_ENTITY_SECRET    — 32-byte hex, generated + registered in the console
 *   CIRCLE_ARC_BLOCKCHAIN   — Circle's blockchain id for Arc Testnet (from Circle docs)
 *   CIRCLE_BASE_URL         — optional; defaults to https://api.circle.com/v1/w3s
 *
 * Prints ONLY the wallet-set id, wallet id, and public address. It never prints
 * the API key, entity secret, or ciphertext. Put the printed ids into
 * CIRCLE_WALLET_ID / CIRCLE_WALLET_ADDRESS (and the wallet-set id for reference).
 *
 *   pnpm tsx scripts/circle/register-wallet.ts
 */
import { CircleDcwClient } from "@arctreasury/chain";

async function main() {
  const client = new CircleDcwClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    baseUrl: process.env.CIRCLE_BASE_URL,
    blockchain: process.env.CIRCLE_ARC_BLOCKCHAIN,
  });
  if (!client.configured()) {
    console.error("Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET first. Nothing was sent.");
    process.exit(1);
  }
  if (!process.env.CIRCLE_ARC_BLOCKCHAIN) {
    console.error("Set CIRCLE_ARC_BLOCKCHAIN to Circle's Arc Testnet blockchain id (from Circle docs). Never guessed.");
    process.exit(1);
  }

  // Idempotency keys are stable so re-running does not create duplicates.
  const ws = await client.createWalletSet("arctreasury-arc-testnet", "arctreasury-walletset-v1");
  console.log("wallet set id:", ws.id);
  const w = await client.createWallet(ws.id, "arctreasury-wallet-v1");
  console.log("wallet id:     ", w.id);
  console.log("wallet address:", w.address, `(${w.blockchain})`);
  console.log("\nNext:");
  console.log("  1. export CIRCLE_WALLET_ID=" + w.id);
  console.log("  2. export CIRCLE_WALLET_ADDRESS=" + w.address);
  console.log("  3. Fund this address with Arc Testnet gas via https://faucet.circle.com");
  console.log("  4. Grant it contract roles:  pnpm tsx scripts/circle/grant-roles.ts " + w.address);
  console.log("  5. Set CIRCLE_* in Vercel production, then remove DEPLOYER_PRIVATE_KEY from Vercel.");
}
main().catch((e) => { console.error("failed:", (e as Error).message); process.exit(1); });
