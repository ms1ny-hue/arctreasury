/**
 * Grant the Circle wallet the contract roles it needs to register, approve, and
 * execute proposals on the deployed TreasuryPolicyExecutor. Run ONCE, locally, by
 * the contract admin (the deploying wallet). This is the only place the local
 * admin key is used; production execution never uses a raw key.
 *
 *   pnpm tsx scripts/circle/grant-roles.ts <circleWalletAddress>
 *
 * Requires DEPLOYER_PRIVATE_KEY (admin) in the local environment only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnetChain } from "@arctreasury/chain";

const RPC = process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network";
const ROLE_ABI = [
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const target = (process.argv[2] ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) { console.error("usage: grant-roles.ts <circleWalletAddress>"); process.exit(1); }
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("DEPLOYER_PRIVATE_KEY (admin) required locally."); process.exit(1); }

  const here = dirname(fileURLToPath(import.meta.url));
  const dep = JSON.parse(readFileSync(resolve(here, "../../packages/contracts/deployments/arc-testnet.json"), "utf8"));
  const executor = dep.address as `0x${string}`;

  const account = privateKeyToAccount(pk as `0x${string}`);
  const pub = createPublicClient({ chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) });
  const wal = createWalletClient({ account, chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) });

  const roles = ["PROPOSER_ROLE", "APPROVER_ROLE", "EXECUTOR_ROLE"] as const;
  let nonce = await pub.getTransactionCount({ address: account.address });
  for (const name of roles) {
    const role = keccak256(toBytes(name));
    const has = await pub.readContract({ address: executor, abi: ROLE_ABI, functionName: "hasRole", args: [role, target as `0x${string}`] });
    if (has) { console.log(`${name}: already granted`); continue; }
    const tx = await wal.writeContract({ address: executor, abi: ROLE_ABI, functionName: "grantRole", args: [role, target as `0x${string}`], account, chain: arcTestnetChain, nonce: nonce++ });
    console.log(`${name}: granted (tx ${tx})`);
    await sleep(2000);
  }
  console.log("\nCircle wallet can now register/approve/execute. Verify a real settlement, then remove DEPLOYER_PRIVATE_KEY from Vercel.");
}
main().catch((e) => { console.error("failed:", (e as Error).message.split("\n")[0]); process.exit(1); });
