"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Loader2, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLegalEntities,
  fetchLiveBrands,
  fetchLiveMerchandise,
  fetchWooConnections,
  type LiveBrand,
  type LiveWooConnection,
  type MerchProduct,
} from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

/** "WooCommerce — Synovil MY (synovil.com)" → "synovil.com". */
function domainOf(conn: LiveWooConnection): string {
  const m = conn.name.match(/\(([^)]+)\)/);
  return m?.[1] ?? conn.name;
}

type Data = {
  brands: LiveBrand[];
  connections: LiveWooConnection[];
  legalEntities: { id: number; legal_name: string }[];
  products: MerchProduct[];
};

function BrandsInner() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveBrand | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [brands, connections, legalEntities, products] = await Promise.all([
          fetchLiveBrands(),
          fetchWooConnections(),
          fetchLegalEntities(),
          fetchLiveMerchandise(),
        ]);
        setData({ brands: brands.filter((b) => b.status === "active"), connections, legalEntities, products });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  // Connections don't carry brand ids; the store domain does (synovilsg.com → Synovil).
  const connectionsForBrand = useMemo(
    () => (brand: LiveBrand) =>
      data?.connections.filter((c) => domainOf(c).toLowerCase().includes(brand.name.toLowerCase())) ?? [],
    [data],
  );

  if (error) {
    return (
      <PageBody>
        <PageHeader title="Brands & Catalog" description="Live brand directory." />
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading brands" />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <PageHeader
        title="Brands & Catalog"
        description="Live brand directory — legal entities, connected storefronts, and catalog & COGS coverage."
      >
        <Link href="/catalog/products" className="inline-flex items-center gap-1 text-sm text-info underline-offset-2 hover:underline">
          Product catalog <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data.brands.map((b) => {
          const conns = connectionsForBrand(b);
          const markets = [...new Set(conns.map((c) => c.config.country_code ?? "MY"))].sort();
          const currencies = markets.map((m) => (m === "SG" ? "SGD" : "MYR"));
          const brandProducts = data.products.filter((p) => p.brand_id === b.id);
          const variants = brandProducts.flatMap((p) => p.variants);
          const costed = variants.filter((v) => v.cost !== null).length;
          const le = data.legalEntities.find((l) => l.id === b.default_legal_entity_id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelected(b)}
              className="rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold">{b.name}</span>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {b.category ?? "commerce"} · {le?.legal_name ?? "—"}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("capitalize", b.status === "active" ? "text-success border-success/30 bg-success/10" : "text-muted-foreground")}
                >
                  {b.status}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
                <div><dt className="text-muted-foreground">Markets</dt><dd className="mt-0.5 font-medium">{markets.join(", ") || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Currencies</dt><dd className="mt-0.5 font-medium">{currencies.join(", ") || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Stores</dt><dd className="tnum mt-0.5 font-medium">{conns.length}</dd></div>
                <div><dt className="text-muted-foreground">Products</dt><dd className="tnum mt-0.5 font-medium">{brandProducts.length}</dd></div>
              </dl>
              {variants.length > 0 && costed < variants.length && (
                <p className="mt-2 text-[11px] text-warning">
                  COGS set on {costed} of {variants.length} variants — margin stays partial until costs land
                </p>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Live mirror of the connected workspace. Sender/claims policies and brand rules arrive with catalog
        governance — source pending.
      </p>

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (() => {
            const conns = connectionsForBrand(selected);
            const brandProducts = data.products.filter((p) => p.brand_id === selected.id);
            const le = data.legalEntities.find((l) => l.id === selected.default_legal_entity_id);
            const markets = [...new Set(conns.map((c) => c.config.country_code ?? "MY"))].sort();
            return (
              <>
                <SheetHeader>
                  <SheetTitle>{selected.name}</SheetTitle>
                  <SheetDescription>{selected.category ?? "commerce"} · {conns.map(domainOf).join(", ") || "no storefronts connected"}</SheetDescription>
                </SheetHeader>
                <div className="space-y-4 px-4 pb-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-1.5 text-sm">
                        <Building2 className="size-4 text-muted-foreground" aria-hidden />Legal & markets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Legal entity</span><span>{le?.legal_name ?? "—"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Markets / currencies</span><span>{markets.join(", ") || "—"} · {markets.map((m) => (m === "SG" ? "SGD" : "MYR")).join(", ") || "—"}</span></div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-1.5 text-sm">
                        <Store className="size-4 text-muted-foreground" aria-hidden />Stores & sync health
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5 text-sm">
                        {conns.map((c) => (
                          <li key={c.id} className="flex items-center justify-between gap-2">
                            <span>{domainOf(c)}</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              {c.config.country_code ?? "MY"}
                              <FreshnessBadge lastSuccessAt={c.last_success_at} slaMinutes={45} />
                            </span>
                          </li>
                        ))}
                        {conns.length === 0 && <li className="text-xs text-muted-foreground">No storefront connections matched.</li>}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-sm">Catalog & COGS</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5 text-sm">
                        {brandProducts.map((p) => {
                          const costed = p.variants.filter((v) => v.cost !== null).length;
                          const sold30 = p.variants.reduce((s, v) => s + Number(v.units_30d), 0);
                          return (
                            <li key={p.id} className="flex items-center justify-between gap-2">
                              <Link href={`/catalog/products?q=${encodeURIComponent(p.name)}`} className="text-info underline-offset-2 hover:underline">
                                {p.name}
                              </Link>
                              <span className="text-xs text-muted-foreground">
                                {p.variants.length} SKUs · {costed}/{p.variants.length} costed · {sold30.toLocaleString()} sold 30d
                              </span>
                            </li>
                          );
                        })}
                        {brandProducts.length === 0 && <li className="text-xs text-muted-foreground">No canonical products yet.</li>}
                      </ul>
                    </CardContent>
                  </Card>

                  <p className="text-[11px] text-muted-foreground">
                    Policies, claims governance, and per-brand rules arrive with catalog governance — source pending.
                  </p>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </PageBody>
  );
}

export default function BrandsPage() {
  return (
    <LiveGuard>
      <BrandsInner />
    </LiveGuard>
  );
}
