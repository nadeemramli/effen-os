"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store/provider";
import { can, type PermissionKey } from "@/lib/rbac/matrix";
import { dateKey } from "@/lib/seed/clock";
import type { Order } from "@/lib/domain/types";
import { hoursSince } from "@/lib/utils/dates";
import {
  rangeDays as storeRangeDays,
  type CustomDateRange,
  type DateRangeKey,
} from "@/lib/store";

export function useSession() {
  return useAppStore((s) => s.session);
}

export function usePermission(permission: PermissionKey): boolean {
  return useAppStore((s) => can(s.session.role, permission));
}

/** "Amir Fazli" -> "AF"; a single-word name falls back to its first two letters. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * The seed persona for the active role, with the signed-in member's real
 * name and initials laid over it when a live session exists — the personas
 * are demo fixtures, so without this every hq_admin shows up as "Nadeem".
 * The persona id, role, and title are untouched: ownership and permissions
 * still resolve against the seeded identity.
 */
export function useActivePersona() {
  const persona = useAppStore(
    (s) => s.personas.find((p) => p.role === s.session.role) ?? s.personas[0]!,
  );
  const authName = useAppStore((s) => s.session.authName);
  /* Memoised: returning a fresh object straight from the selector would give
     Zustand a new snapshot on every render. */
  return useMemo(
    () => (authName ? { ...persona, name: authName, initials: initialsOf(authName) } : persona),
    [persona, authName],
  );
}

/** Days covered by the session date range (for daily-grid filtering). */
export function rangeDays(range: DateRangeKey, custom: CustomDateRange | null = null): number {
  return storeRangeDays(range, custom);
}

export function rangeDateKeys(range: DateRangeKey, custom: CustomDateRange | null = null): string[] {
  const n = rangeDays(range, custom);
  return Array.from({ length: n }, (_, i) => dateKey(i));
}

/** Session-scoped order filter: brand selector + date range. */
export function orderInScope(
  o: Order,
  brandId: string | "all",
  range: DateRangeKey,
  custom: CustomDateRange | null = null,
): boolean {
  if (brandId !== "all" && o.brandId !== brandId) return false;
  const hours = hoursSince(o.placedAt);
  return hours <= rangeDays(range, custom) * 24;
}
