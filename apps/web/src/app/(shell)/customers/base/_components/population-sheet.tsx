"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, InlineCount } from "@/components/states";
import { MOVEMENT_MEASURE_LABELS, type MovementGrain, type MovementMeasure, type MovementPeriod, type TransitionPopulationRow } from "@/lib/domain/lifecycle";
import { fetchCustomerTransitionPopulation, type LiveBrand } from "@/lib/supabase/live";
import { periodLabel } from "./movement-chart";

export interface PopulationTarget {
  period: MovementPeriod;
  measure: MovementMeasure;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
}

/**
 * The exact masked population behind one card or bar segment. Rows come
 * from the same policy version and scope as the chart; the total is the
 * server's count, not the page length.
 */
export function PopulationSheet({
  target,
  grain,
  brandId,
  integrationIn,
  brands,
  onClose,
}: {
  target: PopulationTarget | null;
  grain: MovementGrain;
  brandId: number | null;
  integrationIn: number[] | null;
  brands: LiveBrand[];
  onClose: () => void;
}) {
  // A new target/scope remounts the body, so its paging state resets without effects.
  const bodyKey = target ? `${target.period.period_start}|${target.measure}|${grain}|${brandId ?? ""}|${integrationIn?.join(",") ?? ""}` : "none";

  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        {target && (
          <PopulationBody key={bodyKey} target={target} grain={grain} brandId={brandId} integrationIn={integrationIn} brands={brands} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PopulationBody({
  target,
  grain,
  brandId,
  integrationIn,
  brands,
}: {
  target: PopulationTarget;
  grain: MovementGrain;
  brandId: number | null;
  integrationIn: number[] | null;
  brands: LiveBrand[];
}) {
  const [rows, setRows] = useState<TransitionPopulationRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (after: string | null) =>
      fetchCustomerTransitionPopulation({
        grain,
        periodStart: target.period.period_start,
        measure: target.measure,
        brandId,
        integrationIn,
        cursor: after,
        limit: 50,
      }),
    [grain, target.period.period_start, target.measure, brandId, integrationIn],
  );

  /** Retry / load-more from event handlers. */
  const load = async (after: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage(after);
      setRows((prev) => (after ? [...prev, ...res.rows] : res.rows));
      setTotal(res.total_count);
      setCursor(res.next_cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // First page on mount; every setState happens after the await.
    void (async () => {
      try {
        const res = await fetchPage(null);
        setRows(res.rows);
        setTotal(res.total_count);
        setCursor(res.next_cursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchPage]);

  const brandName = (id: number | null) => brands.find((b) => b.id === id)?.name ?? "—";

  return (
    <>
      <SheetHeader>
        <SheetTitle>{`${MOVEMENT_MEASURE_LABELS[target.measure]} · ${periodLabel(target.period, grain)}`}</SheetTitle>
        <SheetDescription>
          <span className="tnum">
            <InlineCount value={total} width="w-8" /> customers
          </span>
          {" · "}masked list; open a customer for the full profile.
          {!target.period.is_complete && " Period in progress."}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error ? (
          <ErrorState title="Could not load this population" description={error} retry={() => void load(null)} />
        ) : !loading && rows.length === 0 && total === 0 ? (
          <EmptyState title="Nobody in this segment" description="No customers matched this movement for the selected scope and period." />
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Customer</th>
                <th className="py-1.5 pr-2 font-medium">Brand</th>
                <th className="py-1.5 pr-2 font-medium">{target.measure === "lapsed" ? "Lapsed" : target.measure === "new" || target.measure === "reactivated" ? "Entered" : "Since"}</th>
                <th className="py-1.5 pr-2 font-medium">Last purchase</th>
                <th className="py-1.5 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.identity_key}>
                  <td className="py-1.5 pr-2">
                    <Link href={`/customers/${encodeURIComponent(r.identity_key)}`} className="font-medium text-info underline-offset-2 hover:underline">
                      {r.display_name ?? "Unnamed"}
                    </Link>
                    <div className="tnum text-[11px] text-muted-foreground">{r.phone_masked ?? "—"}</div>
                  </td>
                  <td className="py-1.5 pr-2">{brandName(r.acquisition_brand_id)}</td>
                  <td className="tnum py-1.5 pr-2">{when(r.occurred_at)}</td>
                  <td className="tnum py-1.5 pr-2">{when(r.last_qualifying_at)}</td>
                  <td className="tnum py-1.5 text-right">
                    {r.lifecycle_orders}
                    {r.entry_kind === "reactivated" && (
                      <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px] font-normal">back</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Loading…
          </div>
        )}
        {!loading && cursor && (
          <div className="pt-3">
            <Button size="sm" variant="outline" onClick={() => void load(cursor)}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
