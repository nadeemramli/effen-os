"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "@/hooks/use-live-query";
import { ORDER_VIEWS } from "@/lib/domain/order-views";
import { ROUTES } from "@/lib/nav/routes";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchOrderQueueCounts, fetchWooConnections } from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";

/** Child-route key → count. `null` = still loading (render a skeleton, never "0"). */
export type QueueCounts = Partial<Record<string, number | null>>;

const BADGE_KEYS: string[] =
  ROUTES.find((r) => r.key === "orders")?.children?.filter((c) => c.badge === "queue-count").map((c) => c.key) ?? [];

const LOADING: QueueCounts = Object.fromEntries(BADGE_KEYS.map((k) => [k, null]));

/**
 * Per-queue counts for the Orders section nav. One grouped RPC, scoped like
 * the Orders page (brand + market → integration ids). Returns `undefined` when
 * badges should not render at all: demo mode, no Supabase, signed out, or the
 * RPC is not deployed yet.
 */
export function useQueueCounts(enabled: boolean): QueueCounts | undefined {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  // Refetch on in-section navigation: cheap (one RPC) and keeps badges in step with the table.
  const pathname = usePathname();
  const active = enabled && isSupabaseConfigured();

  const { data, error } = useLiveQuery(async () => {
    if (!active) return null;
    const conns = await fetchWooConnections();
    const integrationIn =
      liveMarkets.length > 0
        ? conns.filter((c) => liveMarkets.includes(c.config?.country_code ?? "")).map((c) => c.id)
        : null;
    const counts = await fetchOrderQueueCounts({ brandId: liveBrandId, integrationIn });
    return counts ?? ("unavailable" as const);
  }, [active, liveBrandId, liveMarkets, pathname]);

  return useMemo<QueueCounts | undefined>(() => {
    if (!active || error) return undefined;
    if (data === null) return LOADING;
    if (data === "unavailable") return undefined;
    return {
      ...Object.fromEntries(
        ORDER_VIEWS.filter((v) => v.count).map((v) => [`orders-view-${v.key}`, v.count!(data)]),
      ),
      "orders-view-in-transit": data.courier.in_transit,
      "orders-view-returned": data.courier.returned_14d,
    };
  }, [active, error, data]);
}
