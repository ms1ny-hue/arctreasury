import { describe, it, expect } from "vitest";
import { selectSigner, signerStatus, DisabledSigner, LegacyPrivateKeySigner, CircleSigner } from "../src/signer.js";
import { CircleDcwClient } from "../src/circle.js";

const FAKE_KEY = "0x" + "1".repeat(64);

describe("signer selection — production never signs with a raw key", () => {
  it("production without Circle -> disabled", () => {
    const s = selectSigner({ VERCEL_ENV: "production" } as NodeJS.ProcessEnv);
    expect(s.provider).toBe("disabled");
    expect(s.ready()).toBe(false);
  });

  it("production WITH a raw key present still refuses the raw key -> disabled", () => {
    const s = selectSigner({ VERCEL_ENV: "production", DEPLOYER_PRIVATE_KEY: FAKE_KEY, ALLOW_LOCAL_SIGNER: "true" } as NodeJS.ProcessEnv);
    expect(s.provider).toBe("disabled");
    expect(signerStatus({ VERCEL_ENV: "production", DEPLOYER_PRIVATE_KEY: FAKE_KEY, ALLOW_LOCAL_SIGNER: "true" } as NodeJS.ProcessEnv).rawKeyReachable).toBe(false);
  });

  it("local dev with explicit opt-in -> legacy raw key allowed", () => {
    const s = selectSigner({ DEPLOYER_PRIVATE_KEY: FAKE_KEY, ALLOW_LOCAL_SIGNER: "true" } as NodeJS.ProcessEnv);
    expect(s.provider).toBe("legacy-private-key");
    expect(s.ready()).toBe(true);
  });

  it("local dev without the opt-in flag -> disabled (no accidental raw-key signing)", () => {
    const s = selectSigner({ DEPLOYER_PRIVATE_KEY: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(s.provider).toBe("disabled");
  });

  it("Circle configured (creds + wallet) is selected over the raw key even locally", () => {
    const env = { CIRCLE_API_KEY: "TEST_KEY", CIRCLE_ENTITY_SECRET: "ab".repeat(32), CIRCLE_WALLET_ID: "wallet-1", CIRCLE_ARC_BLOCKCHAIN: "ARC-TESTNET", DEPLOYER_PRIVATE_KEY: FAKE_KEY, ALLOW_LOCAL_SIGNER: "true" } as NodeJS.ProcessEnv;
    expect(selectSigner(env).provider).toBe("circle");
  });
});

describe("DisabledSigner fails loudly", () => {
  it("throws on write and wait", async () => {
    const s = new DisabledSigner("test");
    await expect(s.writeContract({ to: "0x0000000000000000000000000000000000000000", functionName: "x", args: [], idempotencyKey: "k" })).rejects.toThrow(/disabled/i);
    await expect(s.waitForTx({ txHash: null, providerTxId: null, providerState: null })).rejects.toThrow(/disabled/i);
  });
});

describe("LegacyPrivateKeySigner readiness", () => {
  it("not ready with a malformed key", () => {
    expect(new LegacyPrivateKeySigner("nope").ready()).toBe(false);
    expect(new LegacyPrivateKeySigner(undefined).ready()).toBe(false);
  });
});

describe("CircleSigner readiness", () => {
  it("not ready without creds", () => {
    expect(new CircleSigner({}).ready()).toBe(false);
  });
  it("not ready with creds but no wallet id", () => {
    expect(new CircleSigner({ apiKey: "k", entitySecret: "ab".repeat(32) }).ready()).toBe(false);
  });
  it("ready with creds + wallet id", () => {
    expect(new CircleSigner({ apiKey: "k", entitySecret: "ab".repeat(32), walletId: "w1", blockchain: "ARC-TESTNET" }).ready()).toBe(true);
  });
});

describe("CircleDcwClient guards", () => {
  it("configured() is false without creds; mutating calls throw before any network I/O", async () => {
    const c = new CircleDcwClient({});
    expect(c.configured()).toBe(false);
    await expect(c.createWallet("ws", "idem")).rejects.toThrow(); // no blockchain / no creds
  });
});
