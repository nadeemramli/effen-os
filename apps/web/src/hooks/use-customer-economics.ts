"use client";

import { parseAsInteger, useQueryState } from "nuqs";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CustomerEconomics } from "@/lib/domain/customer-economics";
import { fetchCustomerEconomics } from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";

export const MONTH_PRESETS = [6, 12, 15] as const;

/**
 * Customer economics for the top-bar scope (brand + markets) and a cohort
 * window from the URL. One RPC; nothing is derived in the browser.
 */
export function useCustomerEconomics() {
  const [monthsRaw, setMonths] = useQueryState("months", parseAsInteger.withDefault(12));
  const months = (MONTH_PRESETS as readonly number[]).includes(monthsRaw) ? monthsRaw : 12;
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const marketsKey = liveMarkets.join(",");

  const query = useLiveQuery<CustomerEconomics>(
    () => fetchCustomerEconomics({ brandId: liveBrandId, countries: liveMarkets, months }),
    [liveBrandId, marketsKey, months],
  );

  return {
    ...query,
    econ: query.data?.status === "ok" ? query.data : null,
    unavailable: query.data?.status === "unavailable" ? query.data : null,
    months,
    setMonths: (m: number) => void setMonths(m),
    brandId: liveBrandId,
    markets: liveMarkets,
  };
}
