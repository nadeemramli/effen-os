import type { CurrencyCode } from "./enums";

/** Money is stored as integer minor units (sen / cents). */

const SYMBOL: Record<CurrencyCode, string> = {
  MYR: "RM",
  SGD: "S$",
};

export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  opts: { compact?: boolean; signed?: boolean } = {},
): string {
  const major = minor / 100;
  const sign = opts.signed && major > 0 ? "+" : "";
  if (opts.compact && Math.abs(major) >= 10_000) {
    const k = major / 1000;
    return `${sign}${SYMBOL[currency]}${k.toLocaleString("en-MY", { maximumFractionDigits: 1 })}k`;
  }
  return `${sign}${SYMBOL[currency]}${major.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number, digits = 1, signed = false): string {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number, digits = 2): string {
  return value.toFixed(digits);
}
