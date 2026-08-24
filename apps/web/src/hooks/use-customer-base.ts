"use client";

import { useMemo } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CustomerBaseMovement, MovementGrain } from "@/lib/domain/lifecycle";
import { fetchCustomerBaseMovement, fetchWooConnections, type LiveWooConnection } from "@/lib/supabase/live";
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

/**
 * Customer Base data for the current top-bar scope (brand + markets) and the
 * URL's grain/range. The browser never derives lifecycle numbers itself: it
 * renders what live_customer_base_movement returns, including its
 * `unavailable` reasons.
 */
export function useCustomerBase() {
  const [grainRaw, setGrain] = useQueryState("grain", parseAsString.withDefault("month"));
  const grain: MovementGrain = grainRaw === "week" ? "week" : "month";
  const presets = RANGE_PRESETS[grain];
  const [rangeRaw, setRange] = useQueryState("range", parseAsString.withDefault(presets[1]!.key));
  const preset = presets.find((p) => p.key === rangeRaw) ?? presets[1]!;

  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const marketsKey = liveMarkets.join(",");

  const query = useLiveQuery<{ movement: CustomerBaseMovement; integrationIn: number[] | null }>(async () => {
    const conns = await fetchWooConnections();
    const integrationIn = integrationIdsForMarkets(conns, liveMarkets);
    const movement = await fetchCustomerBaseMovement({
      grain,
      from: rangeFrom(grain, preset.periods),
      to: null,
      brandId: liveBrandId,
      integrationIn,
    });
    return { movement, integrationIn };
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
    }),
    [grain, preset, presets, setGrain, setRange],
  );

  return {
    ...query,
    movement: query.data?.movement ?? null,
    integrationIn: query.data?.integrationIn ?? null,
    brandId: liveBrandId,
    controls,
  };
}
