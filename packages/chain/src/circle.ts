/**
 * Circle developer-controlled wallet adapter (Arc Testnet).
 *
 * STATUS: interface + adapter implemented, NOT yet verified against Circle's
 * API. Circle developer-controlled wallets require a CIRCLE_API_KEY and an
 * entity secret provisioned in the Circle console; those are not configured
 * here. This adapter therefore reports `configured: false` and performs no
 * network calls until credentials are supplied. Nothing here is represented as
 * live until the calls are actually exercised and their results stored.
 *
 * Circle is intended as an execution/wallet adapter only. It never bypasses the
 * on-chain policy contract's approval and execution controls.
 */
export interface CircleWallet { id: string; address: string; blockchain: string }
export interface CircleBalance { token: string; amount: string }
export interface CircleTx { id: string; txHash?: string; state: string }

export interface CircleWalletAdapter {
  configured(): boolean;
  createWallet(): Promise<CircleWallet>;
  getBalance(walletId: string): Promise<CircleBalance[]>;
  listTransactions(walletId: string): Promise<CircleTx[]>;
}

export interface CircleConfig {
  apiKey?: string;
  entitySecret?: string;
  baseUrl?: string; // https://api.circle.com/v1/w3s
}

/**
 * Unconfigured adapter: safe default. Every method fails loudly rather than
 * returning fabricated data. Swap for a real implementation once credentials
 * exist; keep the same interface so the rest of the system is unchanged.
 */
export class UnconfiguredCircleAdapter implements CircleWalletAdapter {
  constructor(_cfg: CircleConfig = {}) {}
  configured(): boolean {
    return false; // never true until real API calls are wired and exercised
  }
  private notReady(): never {
    throw new Error("Circle adapter is not configured/verified. Provide CIRCLE_API_KEY + entity secret and a verified implementation before use.");
  }
  async createWallet(): Promise<CircleWallet> { return this.notReady(); }
  async getBalance(): Promise<CircleBalance[]> { return this.notReady(); }
  async listTransactions(): Promise<CircleTx[]> { return this.notReady(); }
}
