"use client";

import { useAppStore } from "@/lib/store/provider";
import { can, type PermissionKey } from "@/lib/rbac/matrix";
import { dateKey } from "@/lib/seed/clock";
import type { Order } from "@/lib/domain/types";
import { hoursSince } from "@/lib/utils/dates";

export function useSession() {
  return useAppStore((s) => s.session);
}

export function usePermission(permission: PermissionKey): boolean {
  return useAppStore((s) => can(s.session.role, permission));
}

export function useActivePersona() {
  return useAppStore(
    (s) => s.personas.find((p) => p.role === s.session.role) ?? s.personas[0]!,
  );
}

/** Days covered by the session date range (for daily-grid filtering). */
export function rangeDays(range: "today" | "7d" | "30d"): number {
  return range === "today" ? 1 : range === "7d" ? 7 : 30;
}

export function rangeDateKeys(range: "today" | "7d" | "30d"): string[] {
  const n = rangeDays(range);
  return Array.from({ length: n }, (_, i) => dateKey(i));
}

/** Session-scoped order filter: brand selector + date range. */
export function orderInScope(
  o: Order,
  brandId: string | "all",
  range: "today" | "7d" | "30d",
): boolean {
  if (brandId !== "all" && o.brandId !== brandId) return false;
  const hours = hoursSince(o.placedAt);
  const limit = range === "today" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return hours <= limit;
}
