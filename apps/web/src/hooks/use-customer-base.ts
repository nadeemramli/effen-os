"use client";

import { useMemo } from "react";
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CustomerBaseMovement, MovementGrain } from "@/lib/domain/lifecycle";
import { ECON_METRICS, type CustomerBaseEconomics, type EconMetric } from "@/lib/domain/customer-base-economics";
import {
  fetchCustomerBaseEconomics,
  fetchCustomerBaseMovement,
  fetchWooConnections,
  type LiveWooConnection,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";

/** Range presets per grain; the value is the number of periods shown. */
export const RANGE_PRESETS: Record<MovementGrain, { key: string; label: string; periods: number }[]> = {
  month: [
    { key: "6m", label: "6 months", periods: 6 },
    { key: "12m", label: "12 months", periods: 12 },
    { key: "24m", label: "24 months", periods: 24 },
  ],
  week: [
    { key: "13w", label: "13 weeks", periods: 13 },
    { key: "26w", label: "26 weeks", periods: 26 },
    { key: "52w", label: "52 weeks", periods: 52 },
  ],
};

/** Store ids behind the selected markets — the same derivation the Orders page uses. */
export function integrationIdsForMarkets(conns: LiveWooConnection[], markets: string[]): number[] | null {
  if (markets.length === 0) return null;
  return conns.filter((c) => markets.includes(c.config?.country_code ?? "")).map((c) => c.id);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `from` for the selected preset: N periods back from today, aligned to the grain. */
export function rangeFrom(grain: MovementGrain, periods: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (grain === "month") {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (periods - 1));
  } else {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow - 7 * (periods - 1));
  }
  return isoDate(d);
}

interface CustomerBasePayload {
  movement: CustomerBaseMovement;
  integrationIn: number[] | null;
  /** Companion series; null with `economicsError` set when its RPC failed — movement still renders. */
  economics: CustomerBaseEconomics | null;
  economicsError: string | null;
}

/**
 * Customer Base data for the current top-bar scope (brand + markets) and the
 * URL's grain/range/metric. The browser never derives lifecycle numbers itself:
 * it renders what live_customer_base_movement returns, including its
 * `unavailable` reasons. The economics companion (nCAC, ad spend, ROAS,
 * revenue, CM3) is fetched alongside for the same periods and scope; a failure
 * there is reported on the chart, not allowed to blank the movement.
 */
export function useCustomerBase() {
  const [grainRaw, setGrain] = useQueryState("grain", parseAsString.withDefault("month"));
  const grain: MovementGrain = grainRaw === "week" ? "week" : "month";
  const presets = RANGE_PRESETS[grain];
  const [rangeRaw, setRange] = useQueryState("range", parseAsString.withDefault(presets[1]!.key));
  const preset = presets.find((p) => p.key === rangeRaw) ?? presets[1]!;
  // Overlaid economics series, e.g. ?series=ncac,cm3 — empty means the plain movement chart.
  const [seriesRaw, setSeries] = useQueryState("series", parseAsArrayOf(parseAsStringLiteral(ECON_METRICS)).withDefault([]));

  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const marketsKey = liveMarkets.join(",");

  const query = useLiveQuery<CustomerBasePayload>(async () => {
    const conns = await fetchWooConnections();
    const integrationIn = integrationIdsForMarkets(conns, liveMarkets);
    const args = { grain, from: rangeFrom(grain, preset.periods), to: null, brandId: liveBrandId, integrationIn };
    const [movement, econ] = await Promise.all([
      fetchCustomerBaseMovement(args),
      fetchCustomerBaseEconomics(args).then(
        (e) => ({ economics: e, economicsError: null as string | null }),
        (err: Error) => ({ economics: null, economicsError: err.message }),
      ),
    ]);
    return { movement, integrationIn, ...econ };
  }, [grain, preset.key, liveBrandId, marketsKey]);

  const controls = useMemo(
    () => ({
      grain,
      setGrain: (g: MovementGrain) => {
        void setGrain(g);
        void setRange(RANGE_PRESETS[g][1]!.key);
      },
      range: preset,
      setRange: (key: string) => void setRange(key),
      presets,
      /** Overlaid series in toggle order (deduplicated, unknown keys dropped by the parser). */
      series: ECON_METRICS.filter((m) => seriesRaw.includes(m)) as EconMetric[],
      setSeries: (next: EconMetric[]) => void setSeries(next.length ? ECON_METRICS.filter((m) => next.includes(m)) : null),
    }),
    [grain, preset, presets, setGrain, setRange, seriesRaw, setSeries],
  );

  return {
    ...query,
    movement: query.data?.movement ?? null,
    economics: query.data?.economics ?? null,
    economicsError: query.data?.economicsError ?? null,
    integrationIn: query.data?.integrationIn ?? null,
    brandId: liveBrandId,
    controls,
  };
}
