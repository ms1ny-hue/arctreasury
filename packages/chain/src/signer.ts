/**
 * Signer abstraction — the ONLY thing that turns an already-approved, already-
 * policy-checked proposal into on-chain transactions. It is a wallet/signing
 * layer, nothing more: every approval, expiry, allowlist, amount, policy-hash,
 * commitment and idempotency check happens BEFORE a signer is ever called
 * (see apps/web/app/api/execute). A signer must never be a place where policy
 * or human approval is decided.
 *
 * Three implementations:
 *   - CircleSigner            — Circle developer-controlled wallet (Arc Testnet).
 *                               The production signer. Requires CIRCLE_API_KEY +
 *                               entity secret provisioned in the Circle console.
 *   - LegacyPrivateKeySigner  — raw viem key. LOCAL DEVELOPMENT ONLY. The factory
 *                               refuses to return it in a Vercel production
 *                               deployment, so the deployed app cannot sign with
 *                               a raw key.
 *   - DisabledSigner          — safe default. Every call throws, loudly.
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnetChain } from "./arc.js";
import { EXECUTOR_ABI } from "./abi.js";
import { CircleDcwClient, type CircleDcwConfig } from "./circle.js";

export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export type SignerProvider = "circle" | "legacy-private-key" | "disabled";

export interface SentContractCall {
  /** Arc transaction hash once the rail assigns one. Null while Circle is still queuing. */
  txHash: Hash | null;
  /** Provider-native id (Circle transaction id), when the provider has one. */
  providerTxId: string | null;
  /** Provider-native lifecycle state, verbatim (never re-interpreted as "settled"). */
  providerState: string | null;
}

export interface Signer {
  readonly provider: SignerProvider;
  /** True only when the signer can actually sign (creds present + wallet known). */
  ready(): boolean;
  /** The signing wallet's Arc address, if known. */
  address(): Promise<Address | null>;
  /**
   * Submit one contract call. `idempotencyKey` MUST be stable per logical action
   * so a retry never double-submits. Returns as soon as the provider accepts the
   * call; the caller polls waitForTx for finality. Never marks anything settled.
   */
  writeContract(args: {
    to: Address;
    functionName: string;
    args: unknown[];
    idempotencyKey: string;
  }): Promise<SentContractCall>;
  /** Poll a submitted call to a terminal-ish state; returns the latest known Arc hash + provider state. */
  waitForTx(sent: SentContractCall, opts?: { timeoutMs?: number }): Promise<SentContractCall>;
}

const RPC = process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Default: nothing configured. Fails loudly instead of fabricating a transaction. */
export class DisabledSigner implements Signer {
  readonly provider = "disabled" as const;
  constructor(private readonly reason = "no signer configured") {}
  ready(): boolean { return false; }
  async address(): Promise<Address | null> { return null; }
  private die(): never { throw new Error(`Signer disabled: ${this.reason}. Configure Circle (CIRCLE_API_KEY + entity secret + wallet) to execute in production.`); }
  async writeContract(): Promise<SentContractCall> { return this.die(); }
  async waitForTx(): Promise<SentContractCall> { return this.die(); }
}

/**
 * Raw private-key signer. LOCAL DEV ONLY — the factory will not hand this back in
 * a deployed Vercel production environment. Kept so local end-to-end tests can
 * exercise the full stored-proposal -> execute path without Circle credentials.
 */
export class LegacyPrivateKeySigner implements Signer {
  readonly provider = "legacy-private-key" as const;
  private readonly pk: Hash | null;
  private nonce: number | null = null;
  constructor(pk?: string) {
    this.pk = pk && /^0x[0-9a-fA-F]{64}$/.test(pk) ? (pk as Hash) : null;
  }
  ready(): boolean { return this.pk !== null; }
  private account() {
    if (!this.pk) throw new Error("LegacyPrivateKeySigner: no key");
    return privateKeyToAccount(this.pk);
  }
  async address(): Promise<Address | null> { return this.pk ? this.account().address : null; }
  private pub() { return createPublicClient({ chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) }); }
  async writeContract(args: { to: Address; functionName: string; args: unknown[] }): Promise<SentContractCall> {
    const account = this.account();
    const wal = createWalletClient({ account, chain: arcTestnetChain, transport: http(RPC, { retryCount: 6, retryDelay: 1200 }) });
    if (this.nonce === null) this.nonce = await this.pub().getTransactionCount({ address: account.address });
    const txHash = await wal.writeContract({ address: args.to, abi: EXECUTOR_ABI, functionName: args.functionName as never, args: args.args as never, account, chain: arcTestnetChain, nonce: this.nonce++ });
    return { txHash, providerTxId: null, providerState: "submitted" };
  }
  async waitForTx(sent: SentContractCall, opts?: { timeoutMs?: number }): Promise<SentContractCall> {
    if (!sent.txHash) return sent;
    const pub = this.pub();
    const deadline = Date.now() + (opts?.timeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      try {
        const r = await pub.getTransactionReceipt({ hash: sent.txHash });
        return { ...sent, providerState: r.status === "success" ? "confirmed" : "reverted" };
      } catch { await sleep(2500); }
    }
    throw new Error("receipt timeout");
  }
}

/**
 * Circle developer-controlled wallet signer. Executes the SAME contract calls via
 * Circle's Wallets API. Circle holds the key and submits the transaction; it does
 * NOT decide policy or approval. Every value passed here was already validated and
 * persisted by the API route.
 */
export class CircleSigner implements Signer {
  readonly provider = "circle" as const;
  private readonly client: CircleDcwClient;
  private readonly walletId: string | null;
  private readonly walletAddress: Address | null;
  constructor(cfg: CircleDcwConfig & { walletId?: string; walletAddress?: string }) {
    this.client = new CircleDcwClient(cfg);
    this.walletId = cfg.walletId ?? null;
    this.walletAddress = cfg.walletAddress && /^0x[0-9a-fA-F]{40}$/.test(cfg.walletAddress) ? (cfg.walletAddress as Address) : null;
  }
  ready(): boolean { return this.client.configured() && this.walletId !== null; }
  async address(): Promise<Address | null> { return this.walletAddress; }
  async writeContract(args: { to: Address; functionName: string; args: unknown[]; idempotencyKey: string }): Promise<SentContractCall> {
    if (!this.walletId) throw new Error("CircleSigner: CIRCLE_WALLET_ID not set");
    const tx = await this.client.contractExecution({
      walletId: this.walletId,
      contractAddress: args.to,
      functionName: args.functionName,
      abi: EXECUTOR_ABI as unknown as unknown[],
      args: args.args,
      idempotencyKey: args.idempotencyKey,
    });
    return { txHash: (tx.txHash as Hash) ?? null, providerTxId: tx.id, providerState: tx.state };
  }
  async waitForTx(sent: SentContractCall, opts?: { timeoutMs?: number }): Promise<SentContractCall> {
    if (!sent.providerTxId) return sent;
    const deadline = Date.now() + (opts?.timeoutMs ?? 180_000);
    let last = sent;
    while (Date.now() < deadline) {
      const tx = await this.client.getTransaction(sent.providerTxId);
      last = { txHash: (tx.txHash as Hash) ?? last.txHash, providerTxId: tx.id, providerState: tx.state };
      // Circle terminal states. COMPLETE/CONFIRMED still require our own on-chain
      // reconciliation before anything is treated as settled — see the reconciler.
      if (["COMPLETE", "CONFIRMED", "FAILED", "CANCELLED", "DENIED"].includes(tx.state)) return last;
      await sleep(3000);
    }
    return last; // timed out; caller decides. Never fabricates success.
  }
}

/**
 * Select the signer for the current environment.
 *
 * Security rule: in a Vercel PRODUCTION deployment the raw-key signer is NEVER
 * returned. Production uses Circle if configured, otherwise the Disabled signer
 * (execution refuses rather than falling back to a raw key). The raw-key path is
 * available only for local development and only when explicitly opted in.
 */
export function selectSigner(env: NodeJS.ProcessEnv = process.env): Signer {
  const isVercelProd = env.VERCEL_ENV === "production";

  const circleCfg = {
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
    baseUrl: env.CIRCLE_BASE_URL,
    walletId: env.CIRCLE_WALLET_ID,
    walletAddress: env.CIRCLE_WALLET_ADDRESS,
    blockchain: env.CIRCLE_ARC_BLOCKCHAIN,
  } as CircleDcwConfig & { walletId?: string; walletAddress?: string };
  const circle = new CircleSigner(circleCfg);
  if (circle.ready()) return circle;

  // Not configured for Circle. In production, refuse the raw key.
  if (isVercelProd) return new DisabledSigner("Circle wallet not provisioned; raw-key signing is disabled in production");

  // Local dev: allow the raw key only behind an explicit opt-in flag.
  if (env.ALLOW_LOCAL_SIGNER === "true" && env.DEPLOYER_PRIVATE_KEY) {
    const legacy = new LegacyPrivateKeySigner(env.DEPLOYER_PRIVATE_KEY);
    if (legacy.ready()) return legacy;
  }
  return new DisabledSigner(isVercelProd ? "production" : "local: set ALLOW_LOCAL_SIGNER=true + DEPLOYER_PRIVATE_KEY, or configure Circle");
}

export function signerStatus(env: NodeJS.ProcessEnv = process.env): {
  signerProvider: SignerProvider;
  circleConfigured: boolean;
  walletNetwork: string | null;
  rawKeyReachable: boolean;
} {
  const s = selectSigner(env);
  const circleConfigured = Boolean(env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET && env.CIRCLE_WALLET_ID);
  return {
    signerProvider: s.provider,
    circleConfigured,
    walletNetwork: circleConfigured ? (env.CIRCLE_ARC_BLOCKCHAIN ?? "unset") : null,
    // True only if the deployed app could actually sign with a raw key. In prod this is always false.
    rawKeyReachable: s.provider === "legacy-private-key",
  };
}
