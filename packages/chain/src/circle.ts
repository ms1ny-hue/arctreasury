/**
 * Circle developer-controlled wallets — Arc Testnet (sandbox/testnet only).
 *
 * Circle is an execution/wallet layer: it holds the key and submits the
 * transaction. It never decides policy or human approval — those are enforced
 * and persisted before any call reaches this client (see apps/web/app/api/execute).
 *
 * Credentials (CIRCLE_API_KEY + entity secret) are supplied via environment only.
 * This module never prints or persists them, and never logs the entity-secret
 * ciphertext. Until credentials exist, `configured()` is false and no network
 * call is made.
 *
 * Environment classification is explicit: `environment` is always "sandbox" /
 * "testnet" here. There is no mainnet path.
 */
import { createPublicKey, publicEncrypt, createHash, constants as cryptoConstants } from "node:crypto";
import { encodeFunctionData } from "viem";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Circle requires UUID-format idempotency keys. Map any stable string to a
 *  deterministic UUID (sha256 -> v5-shaped) so idempotency is preserved. */
function toUuid(seed: string): string {
  if (UUID_RE.test(seed)) return seed;
  const h = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(h.slice(16, 17) || "8", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface CircleWallet { id: string; address: string; blockchain: string }
export interface CircleBalance { token: string; amount: string }
export interface CircleTx { id: string; txHash?: string; state: string }

const DEFAULT_BASE = "https://api.circle.com/v1/w3s";

export interface CircleDcwConfig {
  apiKey?: string;
  entitySecret?: string; // 32-byte hex, generated once in the Circle console. Never printed.
  baseUrl?: string;
  /** Circle blockchain identifier for Arc Testnet — set from Circle docs, never guessed. */
  blockchain?: string;
}

/**
 * Real Circle Wallets REST client. Fails loudly when unconfigured rather than
 * fabricating data. Each request that mutates wallet state carries a fresh
 * entity-secret ciphertext (RSA-OAEP-SHA256 over the entity secret with Circle's
 * registered public key), per Circle's protocol.
 */
export class CircleDcwClient {
  readonly environment = "testnet" as const;
  private readonly apiKey: string | null;
  private readonly entitySecret: string | null;
  private readonly baseUrl: string;
  private readonly blockchain: string | null;
  private cachedPublicKey: string | null = null;

  constructor(cfg: CircleDcwConfig = {}) {
    this.apiKey = cfg.apiKey?.trim() || null;
    this.entitySecret = cfg.entitySecret?.trim() || null;
    this.baseUrl = (cfg.baseUrl?.trim() || DEFAULT_BASE).replace(/\/$/, "");
    this.blockchain = cfg.blockchain?.trim() || null;
  }

  configured(): boolean {
    return this.apiKey !== null && this.entitySecret !== null;
  }

  private headers(): Record<string, string> {
    if (!this.apiKey) throw new Error("Circle not configured: CIRCLE_API_KEY missing");
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const init: RequestInit = { method, headers: this.headers() };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json error body */ }
    if (!res.ok) {
      const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
      throw new Error(`Circle ${method} ${path} -> ${res.status}: ${String(msg).slice(0, 200)}`);
    }
    return json;
  }

  /** Circle's registered entity public key (cached in-memory only). */
  private async publicKey(): Promise<string> {
    if (this.cachedPublicKey) return this.cachedPublicKey;
    const j = await this.req("GET", "/config/entity/publicKey");
    const pk = j?.data?.publicKey;
    if (!pk) throw new Error("Circle: no entity public key returned");
    this.cachedPublicKey = pk;
    return pk;
  }

  /** Fresh per-request ciphertext of the entity secret. Never logged. */
  private async entitySecretCiphertext(): Promise<string> {
    if (!this.entitySecret) throw new Error("Circle not configured: entity secret missing");
    const pubPem = await this.publicKey();
    const key = createPublicKey(pubPem);
    const cipher = publicEncrypt(
      { key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(this.entitySecret, "hex"),
    );
    return cipher.toString("base64");
  }

  /** Create a wallet set (one-time). Returns its id. */
  async createWalletSet(name: string, idempotencyKey: string): Promise<{ id: string; name: string }> {
    const j = await this.req("POST", "/developer/walletSets", { name, idempotencyKey: toUuid(idempotencyKey), entitySecretCiphertext: await this.entitySecretCiphertext() });
    const ws = j?.data?.walletSet;
    if (!ws?.id) throw new Error("Circle: wallet set not created");
    return { id: ws.id, name: ws.name };
  }

  /** Create one Arc-Testnet EOA wallet in a wallet set. Returns its id + address. */
  async createWallet(walletSetId: string, idempotencyKey: string): Promise<CircleWallet> {
    if (!this.blockchain) throw new Error("Circle: CIRCLE_ARC_BLOCKCHAIN not set (Arc Testnet blockchain id from Circle docs)");
    const j = await this.req("POST", "/developer/wallets", {
      walletSetId, idempotencyKey: toUuid(idempotencyKey), blockchains: [this.blockchain], count: 1, accountType: "EOA",
      entitySecretCiphertext: await this.entitySecretCiphertext(),
    });
    const w = j?.data?.wallets?.[0];
    if (!w?.id || !w?.address) throw new Error("Circle: wallet not created");
    return { id: w.id, address: w.address, blockchain: w.blockchain };
  }

  async getWallet(walletId: string): Promise<CircleWallet> {
    const j = await this.req("GET", `/wallets/${walletId}`);
    const w = j?.data?.wallet;
    if (!w?.id) throw new Error("Circle: wallet not found");
    return { id: w.id, address: w.address, blockchain: w.blockchain };
  }

  /**
   * Submit a contract execution. We encode calldata locally with viem and pass it
   * to Circle so Circle is purely the signing/submission layer. Idempotency key is
   * required and must be stable per logical action.
   */
  async contractExecution(args: { walletId: string; contractAddress: string; functionName: string; abi: unknown[]; args: unknown[]; idempotencyKey: string; feeLevel?: "LOW" | "MEDIUM" | "HIGH" }): Promise<CircleTx> {
    const callData = encodeFunctionData({ abi: args.abi, functionName: args.functionName, args: args.args } as unknown as Parameters<typeof encodeFunctionData>[0]);
    const j = await this.req("POST", "/developer/transactions/contractExecution", {
      walletId: args.walletId,
      contractAddress: args.contractAddress,
      callData,
      idempotencyKey: toUuid(args.idempotencyKey),
      entitySecretCiphertext: await this.entitySecretCiphertext(),
      feeLevel: args.feeLevel ?? "MEDIUM",
    });
    const t = j?.data;
    if (!t?.id) throw new Error("Circle: contract execution not accepted");
    return { id: t.id, state: t.state ?? "INITIATED", txHash: t.txHash };
  }

  async getTransaction(id: string): Promise<CircleTx> {
    const j = await this.req("GET", `/transactions/${id}`);
    const t = j?.data?.transaction;
    if (!t?.id) throw new Error("Circle: transaction not found");
    return { id: t.id, state: t.state, txHash: t.txHash };
  }
}

// ---- Legacy read-only adapter kept for the MCP/status "is it configured" surface ----
export interface CircleWalletAdapter {
  configured(): boolean;
  createWallet(): Promise<CircleWallet>;
  getBalance(walletId: string): Promise<CircleBalance[]>;
  listTransactions(walletId: string): Promise<CircleTx[]>;
}
export interface CircleConfig { apiKey?: string; entitySecret?: string; baseUrl?: string }

/** Unconfigured default — every method fails loudly. */
export class UnconfiguredCircleAdapter implements CircleWalletAdapter {
  constructor(_cfg: CircleConfig = {}) {}
  configured(): boolean { return false; }
  private notReady(): never { throw new Error("Circle adapter not configured. Provide CIRCLE_API_KEY + entity secret."); }
  async createWallet(): Promise<CircleWallet> { return this.notReady(); }
  async getBalance(): Promise<CircleBalance[]> { return this.notReady(); }
  async listTransactions(): Promise<CircleTx[]> { return this.notReady(); }
}
