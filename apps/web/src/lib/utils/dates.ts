import { DEMO_NOW } from "@/lib/seed/clock";
import type { FreshnessState } from "@/lib/domain/enums";

/** All relative time is measured against the fixed demo clock. */

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = DEMO_NOW.getTime() - then;
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
  return (DEMO_NOW.getTime() - new Date(iso).getTime()) / 3_600_000;
}

export function freshnessOf(lastSuccessAt: string | null, slaMinutes: number): FreshnessState {
  if (!lastSuccessAt) return "stale";
  const ageMin = hoursSince(lastSuccessAt) * 60;
  if (ageMin <= slaMinutes) return "fresh";
  if (ageMin <= slaMinutes * 3) return "aging";
  return "stale";
}
