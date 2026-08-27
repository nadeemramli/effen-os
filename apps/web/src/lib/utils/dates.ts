import type { FreshnessState } from "@/lib/domain/enums";

/**
 * Relative time against the real wall clock. The seeded dataset used to be
 * measured against the frozen demo clock, which made every live timestamp
 * (and, once the demo profile started rolling the seed forward, every seeded
 * one too) read as nonsense like "in 14d". Seeded timestamps now simply show
 * their true age; live surfaces were always meant to use the real clock.
 */

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  });
}

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function freshnessOf(lastSuccessAt: string | null, slaMinutes: number): FreshnessState {
  if (!lastSuccessAt) return "stale";
  const ageMin = hoursSince(lastSuccessAt) * 60;
  if (ageMin <= slaMinutes) return "fresh";
  if (ageMin <= slaMinutes * 3) return "aging";
  return "stale";
}
