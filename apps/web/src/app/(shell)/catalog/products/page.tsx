"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Link2, Loader2, Package } from "lucide-react";
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
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import {
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

function fmtMoney(currency: string | null, n: number | null): string {
  if (n === null || currency === null) return "—";
  const sym = currency === "MYR" ? "RM" : currency === "SGD" ? "S$" : `${currency} `;
  return `${sym}${Number(n).toFixed(2)}`;
}

/** "WooCommerce — Synovil MY (synovil.com)" → "synovil.com". */
function storeLabel(conn: LiveWooConnection | undefined): string {
  if (!conn) return "—";
  const m = conn.name.match(/\(([^)]+)\)/);
  return m?.[1] ?? conn.name;
}

type Data = {
  products: MerchProduct[];
  queue: SkuMappingRow[];
  brands: LiveBrand[];
  connections: LiveWooConnection[];
};

function ProductsInner() {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [costTarget, setCostTarget] = useState<MerchVariant | null>(null);
  // Mapping picks keyed "integrationId:storeSku" → variant id (as string).
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [products, queue, brands, connections] = await Promise.all([
          fetchLiveMerchandise(),
          fetchSkuMappingQueue(),
          fetchLiveBrands(),
          fetchWooConnections(),
        ]);
        setData({ products, queue, brands, connections });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [reloadKey]);

  const brandName = useCallback(
    (id: number | null) => data?.brands.find((b) => b.id === id)?.name ?? "—",
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

  const selected = data?.products.find((p) => p.id === selectedId) ?? null;

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
        <PageHeader title="Products" description="Live catalog." />
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading catalog" />
      </PageBody>
    );
  }

  const queueVisible = data.queue.filter((r) => liveBrandId === null || r.brand_id === liveBrandId);
  const allVariants = data.products.flatMap((p) => p.variants);
  const costedCount = allVariants.filter((v) => v.cost !== null).length;

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Products"
        description="Live canonical catalog — variants, prices, effective-dated COGS, and store-SKU mappings that key unit economics."
      >
        <Link href="/catalog/brands" className="inline-flex items-center gap-1 text-sm text-info underline-offset-2 hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden /> Brand directory
        </Link>
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Products", value: String(data.products.length) },
          { label: "Variants", value: String(allVariants.length) },
          { label: "Variants with COGS", value: `${costedCount} / ${allVariants.length}`, tone: costedCount === 0 ? "text-warning" : "" },
          { label: "Unmapped store SKUs", value: String(data.queue.length), tone: data.queue.length > 0 ? "text-warning" : "text-success" },
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
              Orders sell under per-store Woo SKUs. Confirm which canonical variant each one is — mappings are
              never guessed, and COGS/LTV only count mapped lines. Options are limited to variants in the
              store&apos;s currency.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Store</th>
                    <th className="pb-2 font-medium">Store SKU</th>
                    <th className="pb-2 font-medium">Item name (latest)</th>
                    <th className="pb-2 text-right font-medium">Units</th>
                    <th className="pb-2 font-medium">Canonical variant</th>
                    <th className="pb-2 text-right font-medium" />
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
                        <td className="py-2 text-xs text-muted-foreground">
                          {storeLabel(data.connections.find((c) => c.id === row.integration_id))}
                        </td>
                        <td className="tnum py-2 font-medium">{row.store_sku}</td>
                        <td className="max-w-64 truncate py-2 text-xs text-muted-foreground" title={row.item_name ?? undefined}>
                          {row.item_name ?? "—"}
                        </td>
                        <td className="tnum py-2 text-right">{Number(row.units).toLocaleString()}</td>
                        <td className="py-2 pr-2">
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
                        <td className="py-2 text-right">
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
          onChange={(e) => setQ(e.target.value)}
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
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                  onClick={() => setSelectedId(p.id)}
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
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {aliasCount > 0 ? `${aliasCount} store SKU${aliasCount > 1 ? "s" : ""}` : "none yet"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        COGS is effective-dated — margin on an order uses the cost that was true when the order was placed.
        Costs pair with revenue in the same currency only; converting SGD↔MYR waits on the Finance FX policy.
        Claims, review states, and ownership arrive when catalog governance connects.
      </p>

      {/* product drawer */}
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
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
                            {v.aliases.length > 0 && (
                              <span className="block text-[10px] text-muted-foreground">
                                store SKUs: {v.aliases.map((a) => a.alias).join(", ")}
                              </span>
                            )}
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

export default function ProductsPage() {
  return (
    <LiveGuard>
      <ProductsInner />
    </LiveGuard>
  );
}
