"use client";

import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { ArrowLeft, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { MoneyCell } from "@/components/tables/cells";
import { RouteGuard } from "@/lib/rbac/guard";
import type { Product } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/money";
import { useSession } from "@/hooks/use-session";
import { useAppStore } from "@/lib/store/provider";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

function stockTone(atp: number, reorderPoint: number): { label: string; className: string } {
  if (atp <= 0) return { label: "Stocked out", className: "text-destructive" };
  if (atp < reorderPoint) return { label: "Low cover", className: "text-warning" };
  return { label: "Sellable", className: "text-success" };
}

function ProductsInner() {
  const session = useSession();
  const products = useAppStore((s) => s.products);
  const brands = useAppStore((s) => s.brands);
  const personas = useAppStore((s) => s.personas);

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [skuFocus, setSkuFocus] = useQueryState("sku", parseAsString);
  const [filter, setFilter] = useQueryState("filter", parseAsString.withDefault("all"));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Selection is derived: an explicit click wins, otherwise the ?sku= deep link.
  const selected: Product | null =
    (selectedId ? products.find((p) => p.id === selectedId) : undefined) ??
    (skuFocus ? products.find((p) => p.variants.some((v) => v.sku === skuFocus)) : undefined) ??
    null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (session.brandId !== "all" && p.brandId !== session.brandId) return false;
      if (filter === "stock-risk" && !p.variants.some((v) => v.onHand - v.reserved <= 0 || v.onHand - v.reserved < v.reorderPoint)) return false;
      if (filter === "in-review" && p.reviewState === "approved") return false;
      if (needle) {
        const hay = [p.name, p.category, ...p.variants.flatMap((v) => [v.sku, ...v.aliases])].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [products, session.brandId, q, filter]);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Products"
        description="Catalog with variants, effective-dated prices, sellability, and approved-claims governance."
      >
        <Link href="/catalog/brands" className="inline-flex items-center gap-1 text-sm text-info underline-offset-2 hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden /> Brand directory
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value || null)}
          placeholder="Search product, SKU, alias…"
          className="h-8 w-64 text-sm"
          aria-label="Search products"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v === "all" ? null : v)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All products</SelectItem>
            <SelectItem value="stock-risk">Stock risk</SelectItem>
            <SelectItem value="in-review">In review</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">SKUs</th>
              <th className="px-3 py-2 text-right font-medium">Price range</th>
              <th className="px-3 py-2 text-right font-medium">ATP</th>
              <th className="px-3 py-2 font-medium">Sellability</th>
              <th className="px-3 py-2 font-medium">Review</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const atp = p.variants.reduce((s, v) => s + v.onHand - v.reserved, 0);
              const minReorder = Math.min(...p.variants.map((v) => v.reorderPoint));
              const tone = stockTone(atp, Math.max(minReorder, 1));
              const prices = p.variants.map((v) => v.prices[0]!);
              const minPrice = Math.min(...prices.map((x) => x.amount));
              const maxPrice = Math.max(...prices.map((x) => x.amount));
              const currency = prices[0]!.currency;
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                  onClick={() => { setSelectedId(p.id); setSkuFocus(null); }}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Package className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{p.name}</span>
                      {p.bundleOf && <Badge variant="outline" className="text-[10px]">bundle</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{p.category}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{brands.find((b) => b.id === p.brandId)?.name.replace(" (Demo)", "")}</td>
                  <td className="tnum px-3 py-2">{p.variants.map((v) => v.sku).join(", ")}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {minPrice === maxPrice
                      ? formatMoney(minPrice, currency)
                      : `${formatMoney(minPrice, currency)} – ${formatMoney(maxPrice, currency)}`}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{atp}</td>
                  <td className={cn("px-3 py-2 text-xs font-medium", tone.className)}>{tone.label}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn("text-[10px] capitalize", p.reviewState === "approved" ? "border-success/30 text-success" : "border-warning/30 text-warning")}>
                      {p.reviewState.replace("_", " ")} · v{p.version}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{personas.find((x) => x.id === p.ownerId)?.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* detail drawer */}
      <Sheet open={selected !== null} onOpenChange={(o) => { if (!o) { setSelectedId(null); setSkuFocus(null); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.name}
                  <Badge variant="outline" className={cn("text-[10px] capitalize", selected.reviewState === "approved" ? "border-success/30 text-success" : "border-warning/30 text-warning")}>
                    {selected.reviewState.replace("_", " ")} · v{selected.version}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {selected.description} Owner: {personas.find((x) => x.id === selected.ownerId)?.name} · effective {formatDate(selected.effectiveFrom)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6 text-sm">
                <section>
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Variants, prices & stock</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-1.5 font-medium">SKU</th>
                        <th className="pb-1.5 font-medium">Variant</th>
                        <th className="pb-1.5 text-right font-medium">Price (effective)</th>
                        <th className="pb-1.5 text-right font-medium">On hand</th>
                        <th className="pb-1.5 text-right font-medium">Reserved</th>
                        <th className="pb-1.5 text-right font-medium">ATP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.variants.map((v) => {
                        const atp = v.onHand - v.reserved;
                        return (
                          <tr key={v.id} className="border-b last:border-0">
                            <td className="tnum py-1.5">{v.sku}</td>
                            <td className="py-1.5">{v.name}
                              {v.aliases.length > 0 && <span className="block text-[10px] text-muted-foreground">aka {v.aliases.join(", ")}</span>}
                              {v.barcode && <span className="tnum block text-[10px] text-muted-foreground">EAN {v.barcode}</span>}
                            </td>
                            <td className="py-1.5 text-right">
                              {v.prices.map((pr) => (
                                <div key={pr.market}>
                                  <MoneyCell minor={pr.amount} currency={pr.currency} />
                                  <span className="ml-1 text-[10px] text-muted-foreground">{pr.market} · from {formatDate(pr.effectiveFrom)}</span>
                                </div>
                              ))}
                            </td>
                            <td className="tnum py-1.5 text-right">{v.onHand}</td>
                            <td className="tnum py-1.5 text-right">{v.reserved}</td>
                            <td className={cn("tnum py-1.5 text-right font-medium", atp <= 0 ? "text-destructive" : atp < v.reorderPoint ? "text-warning" : "text-success")}>{atp}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>

                {selected.bundleOf && (
                  <section>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">Bundle composition</h3>
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {selected.bundleOf.map((b) => (<li key={b.variantId}>{b.quantity} × {b.variantId.replace("VAR-", "").toUpperCase()}</li>))}
                    </ul>
                  </section>
                )}

                <section className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-success/25 bg-success/5 p-2.5">
                    <h3 className="mb-1 text-xs font-medium text-success">Approved claims</h3>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {selected.approvedClaims.map((c) => (<li key={c}>{c}</li>))}
                      {selected.approvedClaims.length === 0 && <li>None registered</li>}
                    </ul>
                  </div>
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 p-2.5">
                    <h3 className="mb-1 text-xs font-medium text-destructive">Prohibited claims</h3>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {selected.prohibitedClaims.map((c) => (<li key={c}>{c}</li>))}
                      {selected.prohibitedClaims.length === 0 && <li>None registered</li>}
                    </ul>
                  </div>
                </section>

                <section className="space-y-2">
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground">Usage</h3>
                    <p className="text-xs">{selected.usage}</p>
                  </div>
                  {selected.warnings.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground">Warnings</h3>
                      <ul className="list-inside list-disc text-xs text-warning">
                        {selected.warnings.map((w) => (<li key={w}>{w}</li>))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground">Target customer</h3>
                    <p className="text-xs text-muted-foreground">{selected.targetCustomer}</p>
                  </div>
                </section>

                {selected.faqs.length > 0 && (
                  <section>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">FAQs</h3>
                    <ul className="space-y-1.5">
                      {selected.faqs.map((f) => (
                        <li key={f.q} className="rounded bg-muted px-2 py-1.5 text-xs">
                          <span className="font-medium">{f.q}</span>
                          <span className="block text-muted-foreground">{f.a}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {selected.objectionHandling.length > 0 && (
                  <section>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">Objection handling</h3>
                    <ul className="space-y-1.5">
                      {selected.objectionHandling.map((o) => (
                        <li key={o.objection} className="rounded bg-muted px-2 py-1.5 text-xs">
                          <span className="font-medium">“{o.objection}”</span>
                          <span className="block text-muted-foreground">{o.response}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">System mappings</h3>
                  <ul className="space-y-1">
                    {selected.mappings.map((m) => (
                      <li key={`${m.system}-${m.externalId}`} className="flex items-center justify-between text-xs">
                        <span>{m.system}</span>
                        {m.status === "mapped" ? (
                          <span className="tnum text-muted-foreground">{m.externalId}</span>
                        ) : (
                          <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">unmapped</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                  {selected.mappings.some((m) => m.status === "unmapped") && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Unmapped systems exclude this product from their feeds — see <Link href="/data-health" className="text-info underline-offset-2 hover:underline">Data Health</Link>.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageBody>
  );
}

export default function ProductsPage() {
  return (
    <RouteGuard permission="catalog.view">
      <ProductsInner />
    </RouteGuard>
  );
}
