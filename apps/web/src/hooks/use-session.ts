"use client";

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

export function useActivePersona() {
  return useAppStore(
    (s) => s.personas.find((p) => p.role === s.session.role) ?? s.personas[0]!,
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
