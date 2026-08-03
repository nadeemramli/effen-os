"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLiveBrands,
  fetchLiveMerchandise,
  fetchSkuMappingQueue,
  type LiveBrand,
  type MerchProduct,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

type Data = { products: MerchProduct[]; brands: LiveBrand[]; unmappedCount: number };

function InventoryInner() {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [products, brands, queue] = await Promise.all([
          fetchLiveMerchandise(),
          fetchLiveBrands(),
          fetchSkuMappingQueue(),
        ]);
        setData({ products, brands, unmappedCount: queue.length });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.products
      .filter((p) => liveBrandId === null || p.brand_id === liveBrandId)
      .flatMap((p) =>
        p.variants.map((v) => ({
          product: p,
          variant: v,
          sold14: Number(v.units_14d),
          sold30: Number(v.units_30d),
          velocity: Number(v.units_14d) / 14,
        })),
      )
      .sort((a, b) => b.sold14 - a.sold14);
  }, [data, liveBrandId]);

  if (error) {
    return (
      <PageBody>
        <PageHeader title="Inventory" description="Live SKU velocity." />
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading inventory" />
      </PageBody>
    );
  }

  const brandName = (id: number) => data.brands.find((b) => b.id === id)?.name ?? "—";
  const totalSold14 = rows.reduce((s, r) => s + r.sold14, 0);
  const mappedSkus = data.products.flatMap((p) => p.variants).reduce((s, v) => s + v.aliases.length, 0);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Inventory"
        description="Sales velocity per canonical SKU from the live order mirror. Physical stock stays with Fighter until the inventory spine lands."
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "SKUs tracked", value: String(rows.length) },
          { label: "Units sold 14d", value: totalSold14.toLocaleString() },
          {
            label: "Store SKUs mapped",
            value: `${mappedSkus} mapped · ${data.unmappedCount} open`,
            tone: data.unmappedCount > 0 ? "text-warning" : "text-success",
          },
          { label: "Inventory value (COGS)", value: "—" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={cn("tnum mt-0.5 text-lg font-semibold", m.tone)}>{m.value}</div>
          </div>
        ))}
      </section>

      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        On-hand, reserved, ATP, and cover need stock counts — physical stock is operated in Fighter today, so
        those columns stay honest &ldquo;—&rdquo; until stocktake capture or the Fighter export lands. Velocity below is
        live: recognized orders (processing + completed), attributed through confirmed SKU mappings
        {data.unmappedCount > 0 && (
          <>
            {" "}
            — <Link href="/catalog" className="text-info underline-offset-2 hover:underline">{data.unmappedCount} store SKUs still unmapped</Link>, their units are not counted yet
          </>
        )}
        .
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Boxes className="size-4 text-muted-foreground" aria-hidden />
            Velocity by SKU
          </CardTitle>
          <p className="text-xs text-muted-foreground">Velocity = units sold in the trailing 14 days ÷ 14.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">SKU</th>
                  <th className="pb-2 font-medium">Brand</th>
                  <th className="pb-2 text-right font-medium">Sold 14d</th>
                  <th className="pb-2 text-right font-medium">Sold 30d</th>
                  <th className="pb-2 text-right font-medium">Velocity /day</th>
                  <th className="pb-2 text-right font-medium">On hand</th>
                  <th className="pb-2 text-right font-medium">Cover</th>
                  <th className="pb-2 font-medium">Stock state</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, variant, sold14, sold30, velocity }) => (
                  <tr key={variant.id} className="border-b last:border-0">
                    <td className="py-2">
                      <Link href={`/catalog?q=${encodeURIComponent(variant.sku)}`} className="tnum text-info underline-offset-2 hover:underline">
                        {variant.sku}
                      </Link>
                      <div className="max-w-52 truncate text-[11px] text-muted-foreground">
                        {product.name} — {variant.name}
                      </div>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{brandName(product.brand_id)}</td>
                    <td className="tnum py-2 text-right">{sold14.toLocaleString()}</td>
                    <td className="tnum py-2 text-right text-muted-foreground">{sold30.toLocaleString()}</td>
                    <td className="tnum py-2 text-right">{velocity > 0 ? velocity.toFixed(1) : "—"}</td>
                    <td className="tnum py-2 text-right text-muted-foreground">—</td>
                    <td className="tnum py-2 text-right text-muted-foreground">—</td>
                    <td className="py-2">
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">source pending</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageBody>
  );
}

export default function InventoryPage() {
  return (
    <LiveGuard>
      <InventoryInner />
    </LiveGuard>
  );
}
