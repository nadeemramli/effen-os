"use client";

import type { CurrencyCode } from "@/lib/domain/enums";
import { formatMoney } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

export function MoneyCell({
  minor,
  currency,
  className,
}: {
  minor: number;
  currency: CurrencyCode;
  className?: string;
}) {
  return <span className={cn("tnum", className)}>{formatMoney(minor, currency)}</span>;
}

export function NumCell({ value, className }: { value: number | string; className?: string }) {
  return <span className={cn("tnum", className)}>{value}</span>;
}
