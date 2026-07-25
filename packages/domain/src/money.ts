/**
 * Money. Integer atomic units only. NEVER JavaScript floating point.
 *
 * A Money value is an exact integer count of the smallest unit of a currency
 * (`amount`), tagged with `currency` and the number of `decimals` that unit
 * represents. USDC in this domain uses 6 decimals (1 USDC = 1_000_000 atoms).
 * The chain layer reads the token's on-chain `decimals()` and rescales at the
 * boundary; domain logic never assumes a scale it did not carry with the value.
 */
export interface Money {
  readonly amount: bigint;
  readonly currency: string;
  readonly decimals: number;
}

export function money(amount: bigint, currency = "USDC", decimals = 6): Money {
  return { amount, currency, decimals };
}

export function zero(currency = "USDC", decimals = 6): Money {
  return { amount: 0n, currency, decimals };
}

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency || a.decimals !== b.decimals) {
    throw new Error(
      `Money mismatch: ${a.currency}/${a.decimals} vs ${b.currency}/${b.decimals}`
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return { ...a, amount: a.amount + b.amount };
}

export function sub(a: Money, b: Money): Money {
  assertSame(a, b);
  return { ...a, amount: a.amount - b.amount };
}

export function neg(a: Money): Money {
  return { ...a, amount: -a.amount };
}

/** Multiply by a plain integer count (e.g. an obligation quantity). */
export function mulInt(a: Money, n: bigint): Money {
  return { ...a, amount: a.amount * n };
}

/** Scale by a rational basis-points-style factor (num/den), floor toward zero. */
export function scale(a: Money, num: bigint, den: bigint): Money {
  if (den === 0n) throw new Error("scale: division by zero");
  return { ...a, amount: (a.amount * num) / den };
}

export function cmp(a: Money, b: Money): number {
  assertSame(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function min(a: Money, b: Money): Money {
  return cmp(a, b) <= 0 ? a : b;
}
export function max(a: Money, b: Money): Money {
  return cmp(a, b) >= 0 ? a : b;
}
export function isNeg(a: Money): boolean {
  return a.amount < 0n;
}
export function isZero(a: Money): boolean {
  return a.amount === 0n;
}
export function clampNonNeg(a: Money): Money {
  return a.amount < 0n ? { ...a, amount: 0n } : a;
}

export function sum(items: Money[], currency = "USDC", decimals = 6): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency, decimals));
}

/** Parse a decimal string like "1250000.50" into atomic Money. Exact, no float. */
export function fromDecimalString(
  s: string,
  currency = "USDC",
  decimals = 6
): Money {
  const trimmed = s.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!m) throw new Error(`Invalid money string: ${s}`);
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = m[2] ?? "0";
  const frac = (m[3] ?? "").slice(0, decimals).padEnd(decimals, "0");
  const atoms = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
  return { amount: sign * atoms, currency, decimals };
}

/** Render atomic Money as a decimal string, e.g. "1,250,000.50". */
export function toDecimalString(m: Money, group = false): string {
  const neg = m.amount < 0n;
  const abs = neg ? -m.amount : m.amount;
  const base = 10n ** BigInt(m.decimals);
  const whole = (abs / base).toString();
  const frac = (abs % base).toString().padStart(m.decimals, "0").replace(/0+$/, "");
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${neg ? "-" : ""}${grouped}${frac ? "." + frac : ""}`;
}

export function format(m: Money): string {
  return `${toDecimalString(m, true)} ${m.currency}`;
}

/** Dollar-hours of prefunding: atomic-units multiplied by whole hours held. */
export function dollarHours(m: Money, hours: number): bigint {
  return m.amount * BigInt(Math.round(hours));
}
