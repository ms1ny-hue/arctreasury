import { describe, it, expect } from "vitest";
import {
  fromDecimalString,
  toDecimalString,
  add,
  sub,
  cmp,
  dollarHours,
  scale,
} from "../src/money.js";

describe("money (integer atomic units, no float)", () => {
  it("round-trips decimal strings exactly", () => {
    const m = fromDecimalString("1250000.50");
    expect(m.amount).toBe(1_250_000_500_000n);
    expect(toDecimalString(m)).toBe("1250000.5");
    expect(toDecimalString(m, true)).toBe("1,250,000.5");
  });

  it("handles values that would lose precision as float", () => {
    const a = fromDecimalString("0.1");
    const b = fromDecimalString("0.2");
    expect(toDecimalString(add(a, b))).toBe("0.3"); // not 0.30000000000000004
  });

  it("adds and subtracts", () => {
    const a = fromDecimalString("100");
    const b = fromDecimalString("30");
    expect(toDecimalString(sub(a, b))).toBe("70");
    expect(cmp(a, b)).toBe(1);
  });

  it("rejects mismatched currency/decimals", () => {
    const a = fromDecimalString("1", "USDC", 6);
    const b = fromDecimalString("1", "EUR", 6);
    expect(() => add(a, b)).toThrow();
  });

  it("scales by a rational factor with floor", () => {
    const a = fromDecimalString("100");
    expect(toDecimalString(scale(a, 105n, 100n))).toBe("105");
    expect(toDecimalString(scale(a, 90n, 100n))).toBe("90");
  });

  it("computes dollar-hours as bigint", () => {
    const a = fromDecimalString("1000000");
    expect(dollarHours(a, 24)).toBe(1_000_000_000_000n * 24n);
  });
});
