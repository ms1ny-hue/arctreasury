import { format, type Money } from "./money.js";

export const fmt = (m: Money): string => format(m);

export function isoUtc(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}
export function humanUtc(epoch: number): string {
  return new Date(epoch * 1000).toUTCString();
}
