"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, InlineCount, RefreshChip, SkeletonTable } from "@/components/states";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { useLiveQuery } from "@/hooks/use-live-query";
import { fetchInventoryRegistry } from "@/lib/supabase/live";

/**
 * Item master and logical locations under the S3 migration rule: identity
 * only. Stock levels stay on product_variants until a movement authority
 * exists, and the channel-publishable formula reports its inputs as
 * unavailable rather than a number.
 */
export default function InventoryRegistryPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="catalog.view">
        <RegistryInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function RegistryInner() {
  const reg = useLiveQuery(fetchInventoryRegistry, []);
  const d = reg.data;
  return (
    <PageBody>
      <PageHeader title="Items & locations" description="The inventory registry Fullkit will build the stock authority on. Nothing here changes a stock level." />
      <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <Badge variant="outline" className="h-5 font-normal">S3 migration rule</Badge>
        <span className="text-muted-foreground">{d?.migration_rule ?? "inventory_items is identity only; stock levels stay on product_variants.stock_on_hand until levels + append-only movements exist."}</span>
        {reg.refreshing && <RefreshChip />}
      </div>
      {reg.error ? (
        <ErrorState title="Could not load the registry" description={reg.error} retry={() => void reg.reload()} />
      ) : reg.loading ? (
        <SkeletonTable rows={6} />
      ) : d ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium">Items</CardTitle>
              <span className="tnum text-xs text-muted-foreground"><InlineCount value={d.items.length} width="w-8" /> items</span>
            </CardHeader>
            <CardContent>
              {d.items.length === 0 ? (
                <EmptyState title="No items" description="Finished goods mirror active product variants; none are active." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="py-1.5 pr-2 font-medium">Type</th><th className="py-1.5 pr-2 font-medium">Item</th><th className="py-1.5 pr-2 font-medium">SKU</th><th className="py-1.5 pr-2 font-medium">UOM</th><th className="py-1.5 pr-2 text-right font-medium" title="product_variants.stock_on_hand — the only stock number today">On hand (variant)</th><th className="py-1.5 text-right font-medium">Base units / pack</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {d.items.map((i) => (
                        <tr key={i.id}>
                          <td className="py-1.5 pr-2 capitalize">{i.item_type.replace(/_/g, " ")}</td>
                          <td className="py-1.5 pr-2">{i.name}</td>
                          <td className="tnum py-1.5 pr-2 text-muted-foreground">{i.sku ?? "—"}</td>
                          <td className="py-1.5 pr-2">{i.uom}</td>
                          <td className="tnum py-1.5 pr-2 text-right">{i.stock_on_hand ?? "—"}</td>
                          <td className="tnum py-1.5 text-right">{i.units_per_pack ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">Raw materials, bulk compound, WIP, packaging and fulfilment materials are typed here but have no rows yet — they arrive with the production batch contract, not from inference.</p>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Logical locations</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1 text-xs">
                  {d.locations.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <span>{l.name}</span>
                      <Badge variant="outline" className="h-5 shrink-0 font-normal text-muted-foreground">authority: {l.authority_system}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-muted-foreground">One authority per location. Every location is `none` until a WMS or Fullkit movements own it; bins come after the physical layout is mapped.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Channel-publishable quantity</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[11px]">{d.publishable.formula}</pre>
                <p className="text-muted-foreground">{d.publishable.note}</p>
                <div className="flex flex-wrap gap-1">
                  {d.publishable.missing.map((m) => <Badge key={m} variant="outline" className="h-5 font-normal text-warning">{m.replace(/_/g, " ")}: missing</Badge>)}
                </div>
                <p className="text-[11px] text-muted-foreground">No quantity is published anywhere until every input is a governed fact.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </PageBody>
  );
}
