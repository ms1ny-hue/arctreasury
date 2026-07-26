/**
 * Grant contract roles for the Circle execution path — with maker/checker kept
 * SEPARATE. Run ONCE, locally, by the contract admin (the deploying wallet).
 *
 *   pnpm tsx scripts/circle/grant-roles.ts <circleExecutorAddress> [approverAddress]
 *
 * Role assignment (deliberate):
 *   - PROPOSER_ROLE + EXECUTOR_ROLE  -> the Circle wallet (registers + executes; both mechanical)
 *   - APPROVER_ROLE                  -> a SEPARATE approver identity, never the Circle wallet
 *
 * This script REFUSES to grant APPROVER_ROLE to the Circle wallet. If no separate
 * approver address is supplied, it grants only proposer+executor and prints what
 * must be disclosed: that on-chain approval authority is not signer-separated, so
 * approval is application-enforced (server-side maker/checker) and must be
 * described that way — no claim of cryptographic approval/execution separation.
 *
 * Requires DEPLOYER_PRIVATE_KEY (admin) in the local environment only. This is the
 * only place a raw key is used; production execution never uses a raw key.
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
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

async function main() {
  const argv = process.argv.slice(2);
  const appEnforced = argv.includes("--app-enforced"); // deliberate opt-in to the weaker single-wallet model
  const positional = argv.filter((a) => !a.startsWith("--"));
  const executorAddr = (positional[0] ?? "").trim();
  const approverAddr = (positional[1] ?? "").trim();
  if (!isAddr(executorAddr)) { console.error("usage: grant-roles.ts <circleExecutorAddress> [approverAddress] [--app-enforced]"); process.exit(1); }
  if (approverAddr && !isAddr(approverAddr)) { console.error("approverAddress is not a valid address"); process.exit(1); }
  if (approverAddr && approverAddr.toLowerCase() === executorAddr.toLowerCase()) {
    console.error("REFUSED: approver must differ from the Circle executor wallet. Maker and checker cannot be the same identity.");
    process.exit(1);
  }
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("DEPLOYER_PRIVATE_KEY (admin) required locally."); process.exit(1); }

  const here = dirname(fileURLToPath(import.meta.url));
  const dep = JSON.parse(readFileSync(resolve(here, "../../packages/contracts/deployments/arc-testnet.json"), "utf8"));
  const executor = dep.address as `0x${string}`;

  const account = privateKeyToAccount(pk as `0x${string}`);
  const pub = createPublicClient({ chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) });
  const wal = createWalletClient({ account, chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) });
  let nonce = await pub.getTransactionCount({ address: account.address });

  const grant = async (roleName: string, to: `0x${string}`) => {
    const role = keccak256(toBytes(roleName));
    if (await pub.readContract({ address: executor, abi: ROLE_ABI, functionName: "hasRole", args: [role, to] })) { console.log(`${roleName} -> ${to}: already granted`); return; }
    const tx = await wal.writeContract({ address: executor, abi: ROLE_ABI, functionName: "grantRole", args: [role, to], account, chain: arcTestnetChain, nonce: nonce++ });
    console.log(`${roleName} -> ${to}: granted (tx ${tx})`);
    await sleep(2000);
  };

  // Circle wallet: register + execute only. NEVER approve.
  await grant("PROPOSER_ROLE", executorAddr as `0x${string}`);
  await grant("EXECUTOR_ROLE", executorAddr as `0x${string}`);

  if (approverAddr) {
    // Option A — true signer separation.
    await grant("APPROVER_ROLE", approverAddr as `0x${string}`);
    console.log("\nSIGNER-SEPARATED (Option A): the Circle wallet cannot approve. On-chain approval requires the separate approver identity.");
    console.log("You MAY claim on-chain separation of approval and execution.");
  } else if (appEnforced) {
    // Option B — deliberate, disclosed single-wallet model.
    await grant("APPROVER_ROLE", executorAddr as `0x${string}`);
    console.log("\n*** APPLICATION-ENFORCED (Option B, --app-enforced) ***");
    console.log("The Circle wallet now holds proposer+approver+executor. On-chain approval and execution are NOT signer-separated.");
    console.log("You MUST describe approval as application-enforced (server-side maker/checker: Postgres CAS, one approval/proposal, independent verifier),");
    console.log("and you MUST NOT claim cryptographic/on-chain separation of approval and execution.");
  } else {
    console.log("\nNothing approver-related was granted. Choose one:");
    console.log("  Option A (separation): re-run with a separate approver ->  grant-roles.ts <circle> <approver>");
    console.log("  Option B (app-enforced): re-run with                 ->  grant-roles.ts <circle> --app-enforced");
    console.log("Without either, on-chain approve cannot happen and execute will revert with NotApproved.");
  }
}
main().catch((e) => { console.error("failed:", (e as Error).message.split("\n")[0]); process.exit(1); });
