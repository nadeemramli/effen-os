"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Link2, Loader2, Package, Store } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { ErrorState, SkeletonTable } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLegalEntities,
  fetchLiveBrands,
  fetchLiveMerchandise,
  fetchSkuMappingQueue,
  fetchWooConnections,
  mapVariantAlias,
  saveVariantCost,
  type LiveBrand,
  type LiveWooConnection,
  type MerchProduct,
  type MerchVariant,
  type SkuMappingRow,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

/**
 * The one Catalog surface. Products-first: the canonical plane (SKUs, prices,
 * effective-dated COGS) beside each store's published Woo plane, reconciled
 * through confirmed mappings. Brands sit one level deeper — a compact strip
 * whose cards open the full brand sheet (legal entity, storefronts & sync
 * health, catalog coverage).
 */

function fmtMoney(currency: string | null, n: number | null): string {
  if (n === null || currency === null) return "—";
  const sym = currency === "MYR" ? "RM" : currency === "SGD" ? "S$" : `${currency} `;
  return `${sym}${Number(n).toFixed(2)}`;
}

/** "WooCommerce — Synovil MY (synovil.com)" → "synovil.com". */
function domainOf(conn: LiveWooConnection | undefined): string {
  if (!conn) return "—";
  const m = conn.name.match(/\(([^)]+)\)/);
  return m?.[1] ?? conn.name;
}

function variantHasDrift(v: MerchVariant): boolean {
  return v.aliases.some(
    (a) => a.store_price !== null && v.price !== null && Number(a.store_price) !== Number(v.price),
  );
}

type Data = {
  products: MerchProduct[];
  queue: SkuMappingRow[];
  brands: LiveBrand[];
  connections: LiveWooConnection[];
  legalEntities: { id: number; legal_name: string }[];
};

const PAGE_DESCRIPTION =
  "Two catalogs, side by side: the canonical plane (SKUs, prices, effective-dated COGS — owned here) and each store's published Woo plane, reconciled through confirmed mappings.";

function CatalogInner() {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [skuFocus, setSkuFocus] = useQueryState("sku", parseAsString);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<LiveBrand | null>(null);
  const [costTarget, setCostTarget] = useState<MerchVariant | null>(null);
  // Mapping picks keyed "integrationId:storeSku" → variant id (as string).
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [products, queue, brands, connections, legalEntities] = await Promise.all([
          fetchLiveMerchandise(),
          fetchSkuMappingQueue(),
          fetchLiveBrands(),
          fetchWooConnections(),
          fetchLegalEntities(),
        ]);
        setData({ products, queue, brands: brands.filter((b) => b.status === "active"), connections, legalEntities });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [reloadKey]);

  const brandName = useCallback(
    (id: number | null) => data?.brands.find((b) => b.id === id)?.name ?? "—",
    [data],
  );

  // Connections don't carry brand ids; the store domain does (synovilsg.com → Synovil).
  const connectionsForBrand = useCallback(
    (brand: LiveBrand) =>
      data?.connections.filter((c) => domainOf(c).toLowerCase().includes(brand.name.toLowerCase())) ?? [],
    [data],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.products.filter((p) => {
      if (liveBrandId !== null && p.brand_id !== liveBrandId) return false;
      if (!needle) return true;
      const hay = [p.name, ...p.variants.flatMap((v) => [v.sku, v.name, ...v.aliases.map((a) => a.alias)])]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [data, liveBrandId, q]);

  // Explicit click wins; otherwise a ?sku= deep link (canonical SKU or store alias).
  const selected: MerchProduct | null =
    (selectedId !== null ? data?.products.find((p) => p.id === selectedId) : undefined) ??
    (skuFocus
      ? data?.products.find((p) => p.variants.some((v) => v.sku === skuFocus || v.aliases.some((a) => a.alias === skuFocus)))
      : undefined) ??
    null;

  /** Variant options for one queue row: same currency as the store; brand's own first. */
  const optionsFor = useCallback(
    (row: SkuMappingRow): { variant: MerchVariant; product: MerchProduct }[] => {
      if (!data) return [];
      const opts = data.products
        .flatMap((p) => p.variants.map((v) => ({ variant: v, product: p })))
        .filter((o) => row.currency_code === null || o.variant.currency_code === row.currency_code);
      return opts.sort((a, b) => {
        const aOwn = a.product.brand_id === row.brand_id ? 0 : 1;
        const bOwn = b.product.brand_id === row.brand_id ? 0 : 1;
        return aOwn - bOwn || a.variant.sku.localeCompare(b.variant.sku);
      });
    },
    [data],
  );

  if (error) {
    return (
      <PageBody>
        <PageHeader title="Catalog" description={PAGE_DESCRIPTION} />
        <ErrorState
          title="Could not load the catalog"
          description={error}
          retry={() => {
            setError(null);
            reload();
          }}
        />
      </PageBody>
    );
  }
  if (!data) {
    // Page frame renders immediately; each section loads in place.
    return (
      <PageBody className="max-w-none">
        <PageHeader title="Catalog" description={PAGE_DESCRIPTION} />
        <div role="status" aria-label="Loading catalog" className="space-y-5">
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-2.5">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="mt-1.5 h-3.5 w-36" />
                <Skeleton className="mt-1 h-3.5 w-24" />
              </div>
            ))}
          </section>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-2.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="mt-1.5 h-6 w-16" />
              </div>
            ))}
          </section>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent>
              <SkeletonTable rows={8} cols={6} framed={false} />
            </CardContent>
          </Card>
        </div>
      </PageBody>
    );
  }

  const queueVisible = data.queue.filter((r) => liveBrandId === null || r.brand_id === liveBrandId);
  const allVariants = data.products.flatMap((p) => p.variants);
  const costedCount = allVariants.filter((v) => v.cost !== null).length;
  const driftCount = allVariants.filter(variantHasDrift).length;

  return (
    <PageBody className="max-w-none">
      <PageHeader title="Catalog" description={PAGE_DESCRIPTION} />

      {/* Brand strip — compact context, full detail in the sheet. */}
      <section aria-label="Brands" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {data.brands.map((b) => {
          const conns = connectionsForBrand(b);
          const markets = [...new Set(conns.map((c) => c.config.country_code ?? "MY"))].sort();
          const brandProducts = data.products.filter((p) => p.brand_id === b.id);
          const variants = brandProducts.flatMap((p) => p.variants);
          const costed = variants.filter((v) => v.cost !== null).length;
          const drift = variants.some(variantHasDrift);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBrand(b)}
              className="rounded-lg border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{b.name}</span>
                <span
                  aria-label={b.status}
                  className={cn("size-1.5 shrink-0 rounded-full", b.status === "active" ? "bg-success" : "bg-muted-foreground/40")}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {markets.join(" · ") || "—"} · {conns.length} store{conns.length === 1 ? "" : "s"} · {brandProducts.length} products
              </div>
              <div className="mt-0.5 text-[11px]">
                <span className={cn(costed === variants.length && variants.length > 0 ? "text-success" : "text-warning")}>
                  COGS {costed}/{variants.length}
                </span>
                {drift && <span className="ml-2 text-warning">price drift</span>}
              </div>
            </button>
          );
        })}
      </section>

      <section aria-label="Catalog health" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Variants", value: String(allVariants.length) },
          { label: "Variants with COGS", value: `${costedCount} / ${allVariants.length}`, tone: costedCount === 0 ? "text-warning" : "" },
          { label: "Unmapped store SKUs", value: String(data.queue.length), tone: data.queue.length > 0 ? "text-warning" : "text-success" },
          { label: "Price drift", value: String(driftCount), tone: driftCount > 0 ? "text-warning" : "text-success" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={cn("tnum mt-0.5 text-lg font-semibold", m.tone)}>{m.value}</div>
          </div>
        ))}
      </section>

      {queueVisible.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="size-4 text-warning" aria-hidden />
              Unmapped store SKUs — {queueVisible.length} to confirm
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The published Woo catalogs and the order stream both feed this queue, so new store products
              appear here before their first sale. Confirm which canonical variant each one is — mappings are
              never guessed, and COGS/LTV only count mapped lines. Options are limited to variants in the
              store&apos;s currency.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 pb-2 font-medium">Store</th>
                    <th className="px-3 pb-2 font-medium">Store SKU</th>
                    <th className="px-3 pb-2 font-medium">Item name</th>
                    <th className="px-3 pb-2 text-right font-medium">Units sold</th>
                    <th className="px-3 pb-2 text-right font-medium">Store price</th>
                    <th className="px-3 pb-2 font-medium">Canonical variant</th>
                    <th className="px-3 pb-2 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {queueVisible.map((row) => {
                    const key = `${row.integration_id}:${row.store_sku}`;
                    const opts = optionsFor(row);
                    const exact = opts.find(
                      (o) =>
                        o.product.brand_id === row.brand_id &&
                        o.variant.name.trim().toLowerCase() === (row.item_name ?? "").trim().toLowerCase(),
                    );
                    const pick = picks[key] ?? (exact ? String(exact.variant.id) : "");
                    return (
                      <tr key={key} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {domainOf(data.connections.find((c) => c.id === row.integration_id))}
                        </td>
                        <td className="tnum whitespace-nowrap px-3 py-2 font-medium">
                          {row.store_sku}
                          {row.published && Number(row.units) === 0 && (
                            <Badge variant="outline" className="ml-1.5 text-[9px] text-info border-info/30">new · unsold</Badge>
                          )}
                          {!row.published && (
                            <Badge variant="outline" className="ml-1.5 text-[9px] text-muted-foreground">no longer published</Badge>
                          )}
                        </td>
                        <td className="max-w-64 truncate px-3 py-2 text-xs text-muted-foreground" title={row.item_name ?? undefined}>
                          {row.item_name ?? "—"}
                        </td>
                        <td className="tnum px-3 py-2 text-right">{Number(row.units).toLocaleString()}</td>
                        <td className="tnum whitespace-nowrap px-3 py-2 text-right">{fmtMoney(row.currency_code, row.store_price)}</td>
                        <td className="px-3 py-2">
                          <Select value={pick} onValueChange={(v) => setPicks((s) => ({ ...s, [key]: v }))}>
                            <SelectTrigger className="h-7 w-64 text-xs" aria-label={`Map ${row.store_sku}`}>
                              <SelectValue placeholder="Pick a variant…" />
                            </SelectTrigger>
                            <SelectContent>
                              {opts.map((o) => (
                                <SelectItem key={o.variant.id} value={String(o.variant.id)}>
                                  {o.variant.sku} — {o.variant.name} ({brandName(o.product.brand_id)})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={!pick || busyKey === key}
                            onClick={async () => {
                              setBusyKey(key);
                              try {
                                await mapVariantAlias(row.integration_id, row.store_sku, Number(pick));
                                toast.success(`${row.store_sku} mapped`, { description: "Audited · unit economics pick it up immediately" });
                                reload();
                              } catch (e) {
                                toast.error("Mapping failed", { description: (e as Error).message });
                              } finally {
                                setBusyKey(null);
                              }
                            }}
                          >
                            {busyKey === key ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Confirm"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value || null)}
          placeholder="Search product, SKU, alias…"
          className="h-8 w-64 text-sm"
          aria-label="Search products"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">SKUs</th>
              <th className="px-3 py-2 text-right font-medium">Price range</th>
              <th className="px-3 py-2 text-right font-medium">Sold 30d</th>
              <th className="px-3 py-2 font-medium">COGS</th>
              <th className="px-3 py-2 font-medium">Store mappings</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const prices = p.variants.filter((v) => v.price !== null);
              const minPrice = prices.length ? Math.min(...prices.map((v) => Number(v.price))) : null;
              const maxPrice = prices.length ? Math.max(...prices.map((v) => Number(v.price))) : null;
              const ccy = prices[0]?.currency_code ?? null;
              const sold30 = p.variants.reduce((s, v) => s + Number(v.units_30d), 0);
              const costed = p.variants.filter((v) => v.cost !== null).length;
              const aliasCount = p.variants.reduce((s, v) => s + v.aliases.length, 0);
              const hasDrift = p.variants.some(variantHasDrift);
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                  onClick={() => { setSelectedId(p.id); void setSkuFocus(null); }}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Package className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{p.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{p.category ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{brandName(p.brand_id)}</td>
                  <td className="tnum px-3 py-2 text-xs">{p.variants.map((v) => v.sku).join(", ")}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {minPrice === null
                      ? "—"
                      : minPrice === maxPrice
                        ? fmtMoney(ccy, minPrice)
                        : `${fmtMoney(ccy, minPrice)} – ${fmtMoney(ccy, maxPrice)}`}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{sold30.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        costed === p.variants.length && costed > 0
                          ? "border-success/30 text-success"
                          : costed > 0
                            ? "border-warning/30 text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {costed} / {p.variants.length} costed
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="text-muted-foreground">
                      {aliasCount > 0 ? `${aliasCount} store SKU${aliasCount > 1 ? "s" : ""}` : "none yet"}
                    </span>
                    {hasDrift && (
                      <Badge variant="outline" className="ml-1.5 border-warning/30 text-[9px] text-warning">price drift</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        The store plane mirrors each Woo catalog hourly, read-only — marketers keep full ownership of
        WordPress; this is where finance sees it. COGS is effective-dated — margin on an order uses the cost
        that was true when the order was placed. Costs pair with revenue in the same currency only;
        converting SGD↔MYR waits on the Finance FX policy.
      </p>

      {/* product drawer */}
      <Sheet open={selected !== null} onOpenChange={(o) => { if (!o) { setSelectedId(null); void setSkuFocus(null); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>
                  {brandName(selected.brand_id)} · {selected.category ?? "package catalog"} · live mirror
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6 text-sm">
                <section>
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Variants, prices, COGS & mappings</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-1.5 font-medium">SKU</th>
                        <th className="pb-1.5 font-medium">Variant</th>
                        <th className="pb-1.5 text-right font-medium">Price</th>
                        <th className="pb-1.5 text-right font-medium">COGS</th>
                        <th className="pb-1.5 text-right font-medium">Sold 30d</th>
                        <th className="pb-1.5 text-right font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {selected.variants.map((v) => (
                        <tr key={v.id} className="border-b last:border-0 align-top">
                          <td className="tnum py-1.5">{v.sku}</td>
                          <td className="py-1.5">
                            {v.name}
                            {v.aliases.map((a) => {
                              const drift =
                                a.store_price !== null && v.price !== null && Number(a.store_price) !== Number(v.price);
                              return (
                                <span key={`${a.integration_id}:${a.alias}`} className="block text-[10px] text-muted-foreground">
                                  <span className="tnum">{a.alias}</span>
                                  {a.store_price !== null && (
                                    <span className={cn("ml-1", drift && "font-medium text-warning")}>
                                      store {fmtMoney(v.currency_code, Number(a.store_price))}
                                      {drift && " ≠ canonical"}
                                    </span>
                                  )}
                                  {a.store_status !== null && a.store_status !== "publish" && (
                                    <span className="ml-1">({a.store_status})</span>
                                  )}
                                </span>
                              );
                            })}
                          </td>
                          <td className="tnum py-1.5 text-right">{fmtMoney(v.currency_code, v.price)}</td>
                          <td className="tnum py-1.5 text-right">
                            {v.cost === null ? (
                              <span className="text-warning">not set</span>
                            ) : (
                              <>
                                {fmtMoney(v.cost_currency, v.cost)}
                                <span className="block text-[10px] text-muted-foreground">from {v.cost_effective_from}</span>
                              </>
                            )}
                          </td>
                          <td className="tnum py-1.5 text-right">{Number(v.units_30d).toLocaleString()}</td>
                          <td className="py-1.5 pl-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => setCostTarget(v)}
                            >
                              {v.cost === null ? "Set cost" : "Update"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <p className="text-[11px] text-muted-foreground">
                  Cost changes are audited and versioned by effective date (HQ admin / finance only). Claims,
                  FAQs, and objection handling for this product arrive with catalog governance — source pending.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* brand sheet — the old brand directory, one level deeper */}
      <Sheet open={selectedBrand !== null} onOpenChange={(o) => !o && setSelectedBrand(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedBrand && (() => {
            const conns = connectionsForBrand(selectedBrand);
            const brandProducts = data.products.filter((p) => p.brand_id === selectedBrand.id);
            const le = data.legalEntities.find((l) => l.id === selectedBrand.default_legal_entity_id);
            const markets = [...new Set(conns.map((c) => c.config.country_code ?? "MY"))].sort();
            return (
              <>
                <SheetHeader>
                  <SheetTitle>{selectedBrand.name}</SheetTitle>
                  <SheetDescription>
                    {selectedBrand.category ?? "commerce"} · {conns.map((c) => domainOf(c)).join(", ") || "no storefronts connected"}
                  </SheetDescription>
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
                              <button
                                type="button"
                                className="text-info underline-offset-2 hover:underline"
                                onClick={() => { setSelectedBrand(null); setSelectedId(p.id); void setSkuFocus(null); }}
                              >
                                {p.name}
                              </button>
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

      <CostDialog key={costTarget?.id ?? "none"} target={costTarget} onClose={() => setCostTarget(null)} onSaved={reload} />
    </PageBody>
  );
}

function CostDialog({
  target,
  onClose,
  onSaved,
}: {
  target: MerchVariant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Keyed by target id at the call site, so each variant opens a fresh dialog.
  const [cost, setCost] = useState(() => (target?.cost != null ? String(target.cost) : ""));
  const [currency, setCurrency] = useState(() => target?.cost_currency ?? target?.currency_code ?? "MYR");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>COGS — {target?.sku}</DialogTitle>
          <DialogDescription>
            Landed cost per unit sold ({target?.name}). Effective-dated: orders placed before this date keep
            the previous cost. Audited.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cogs-amount">Cost per unit</Label>
              <Input id="cogs-amount" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 38.50" />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MYR">MYR</SelectItem>
                  <SelectItem value="SGD">SGD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cogs-from">Effective from</Label>
            <Input id="cogs-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cogs-note">Note (optional)</Label>
            <Input id="cogs-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q3 production batch quote" />
          </div>
          {target && currency !== target.currency_code && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
              This variant sells in {target.currency_code}. A {currency} cost will not pair with its revenue
              until the Finance FX policy exists — margin for it stays &ldquo;—&rdquo;.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !cost || Number.isNaN(Number(cost)) || Number(cost) < 0 || !effectiveFrom}
            onClick={async () => {
              if (!target) return;
              setBusy(true);
              try {
                await saveVariantCost(target.id, Number(cost), currency, effectiveFrom, note || undefined);
                toast.success(`${target.sku} cost saved`, { description: `${currency} ${Number(cost).toFixed(2)} effective ${effectiveFrom}` });
                onSaved();
                onClose();
              } catch (e) {
                toast.error("Could not save cost", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Save cost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CatalogPage() {
  return (
    <LiveGuard>
      <CatalogInner />
    </LiveGuard>
  );
}
