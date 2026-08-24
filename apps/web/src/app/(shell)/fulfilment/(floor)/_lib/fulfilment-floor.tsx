"use client";

import { createContext, useContext, useMemo } from "react";
import { useLiveQuery } from "@/hooks/use-live-query";
import {
  fetchAiSuggestedOrderIds,
  fetchFulfilmentPipeline,
  fetchLiveBrands,
  fetchLiveOrdersPage,
  fetchNvNetwork,
  fetchNvReturns,
  fetchShadowReport,
  fetchShipReadiness,
  fetchWooConnections,
  type FulfilmentPipelineRow,
  type LiveBrand,
  type LiveNvShipment,
  type LiveOrderRow,
  type LiveOrdersPage,
  type NvReturns,
  type ShadowReport,
  type ShipReadinessRow,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";
import { NV_EXCEPTION_WORDS } from "./format";

/* Original pick → pack → handover layout, live-fed:
 * - To pick        = Woo `processing` orders (paid, awaiting fulfilment)
 * - Picking        = Fighter's internal stage — no live signal until Slice 3
 * - Packed/ready   = Ninja Van parcels at "Pending Pickup"
 * - In transit     = Ninja Van parcels moving, not terminal, not an exception
 * - Exceptions     = Woo on-hold/failed orders + NV exception parcels
 * Handover manifests become actionable in the Slice 3 write pilot. */

type NvNetwork = Awaited<ReturnType<typeof fetchNvNetwork>>;
type Readiness = Awaited<ReturnType<typeof fetchShipReadiness>>;

interface FloorSnapshot {
  toPick: LiveOrdersPage;
  holds: LiveOrdersPage;
  network: NvNetwork;
  brands: LiveBrand[];
  readiness: Readiness;
  pipeline: FulfilmentPipelineRow[];
  shadow: ShadowReport | null;
  aiOrderIds: Set<number>;
  returns: NvReturns | null;
}

export interface FulfilmentFloor {
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
  toPick: LiveOrdersPage;
  holds: LiveOrdersPage;
  network: NvNetwork | null;
  readiness: Readiness;
  brands: LiveBrand[];
  pipeline: FulfilmentPipelineRow[];
  shadow: ShadowReport | null;
  aiOrderIds: Set<number>;
  returns: NvReturns | null;
  pendingPickup: LiveNvShipment[];
  nvExceptions: LiveNvShipment[];
  /** Moving parcels; capped by fetchNvNetwork's page size, so treat as "at least". */
  inTransit: LiveNvShipment[];
  brandName: (id: number | null) => string;
}

const Ctx = createContext<FulfilmentFloor | null>(null);

const EMPTY_PAGE = { rows: [] as LiveOrderRow[], total: 0 };
const EMPTY_READINESS: Readiness = { rows: [] as ShipReadinessRow[], checked: 0, flagged: 0, corrected: 0 };

/**
 * One floor snapshot shared by every /fulfilment page. Lives in the route
 * group layout, so moving between Overview / Ship-readiness / Exceptions /
 * Returns does not refetch; a brand or market change does, with the stale
 * floor dimmed rather than hidden.
 */
export function FulfilmentFloorProvider({ children }: { children: React.ReactNode }) {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  // A failed fetch surfaces instead of rendering a clean floor.
  const { data, error, loading, refreshing, reload } = useLiveQuery<FloorSnapshot>(async () => {
    const conns = await fetchWooConnections();
    const integrationIn =
      liveMarkets.length > 0
        ? conns.filter((c) => liveMarkets.includes(c.config?.country_code ?? "")).map((c) => c.id)
        : null;
    const base = { page: 1, pageSize: 8, brandId: liveBrandId, integrationId: null, integrationIn, currency: null, sinceHours: null, search: "" };
    const [pick, hold, nv, b, ready, pipe, shadowReport, aiIds, returns] = await Promise.all([
      fetchLiveOrdersPage({ ...base, status: "processing" }),
      fetchLiveOrdersPage({ ...base, status: null, statusIn: ["on-hold", "failed"] }),
      fetchNvNetwork(),
      fetchLiveBrands(),
      fetchShipReadiness(14),
      fetchFulfilmentPipeline(14).catch(() => [] as FulfilmentPipelineRow[]),
      fetchShadowReport(14).catch(() => null),
      fetchAiSuggestedOrderIds().catch(() => new Set<number>()),
      fetchNvReturns(14).catch(() => null as NvReturns | null),
    ]);
    return { toPick: pick, holds: hold, network: nv, brands: b, readiness: ready, pipeline: pipe, shadow: shadowReport, aiOrderIds: aiIds, returns };
  }, [liveBrandId, liveMarkets]);

  const value = useMemo<FulfilmentFloor>(() => {
    const network = data?.network ?? null;
    const brands = data?.brands ?? [];
    const shipments = network?.shipments ?? [];
    const lc = (s: LiveNvShipment) => (s.status ?? "").toLowerCase();
    const isPendingPickup = (s: LiveNvShipment) => lc(s).includes("pending pickup");
    const isException = (s: LiveNvShipment) => NV_EXCEPTION_WORDS.some((w) => lc(s).includes(w));
    return {
      error,
      loading,
      refreshing,
      reload,
      toPick: data?.toPick ?? EMPTY_PAGE,
      holds: data?.holds ?? EMPTY_PAGE,
      network,
      readiness: data?.readiness ?? EMPTY_READINESS,
      brands,
      pipeline: data?.pipeline ?? [],
      shadow: data?.shadow ?? null,
      aiOrderIds: data?.aiOrderIds ?? new Set<number>(),
      returns: data?.returns ?? null,
      pendingPickup: shipments.filter(isPendingPickup),
      nvExceptions: shipments.filter(isException),
      inTransit: shipments.filter((s) => !s.is_terminal && !isPendingPickup(s) && !isException(s)),
      brandName: (id) => brands.find((b) => b.id === id)?.name ?? "—",
    };
  }, [data, error, loading, refreshing, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFulfilmentFloor(): FulfilmentFloor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFulfilmentFloor must be used inside FulfilmentFloorProvider");
  return v;
}
