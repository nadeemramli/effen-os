"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Building2, Globe, ShieldCheck, Store } from "lucide-react";
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
import { RouteGuard } from "@/lib/rbac/guard";
import type { Brand } from "@/lib/domain/types";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

function BrandsInner() {
  const brands = useAppStore((s) => s.brands);
  const stores = useAppStore((s) => s.stores);
  const legalEntities = useAppStore((s) => s.legalEntities);
  const products = useAppStore((s) => s.products);
  const integrations = useAppStore((s) => s.integrations);
  const dqIssues = useAppStore((s) => s.dqIssues);
  const [selected, setSelected] = useState<Brand | null>(null);

  return (
    <PageBody>
      <PageHeader
        title="Brands & Catalog"
        description="Brand directory — legal entities, channels, policies, and catalog governance."
      >
        <Link href="/catalog/products" className="inline-flex items-center gap-1 text-sm text-info underline-offset-2 hover:underline">
          Product catalog <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {brands.map((b) => {
          const brandStores = stores.filter((s) => s.brandId === b.id);
          const brandProducts = products.filter((p) => p.brandId === b.id);
          const le = legalEntities.find((l) => l.id === b.legalEntityId);
          const brandIntegrations = integrations.filter((i) => i.brandScope.length === 0 || i.brandScope.includes(b.id));
          const issues = dqIssues.filter((i) => i.status !== "resolved" && brandIntegrations.some((bi) => bi.id === i.integrationId));
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelected(b)}
              className="rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{b.name}</span>
                    {b.isDemo && <Badge variant="outline" className="text-[10px] text-muted-foreground">synthetic demo brand</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{b.category} · {le?.name}</div>
                </div>
                <Badge variant="outline" className={cn("capitalize", b.status === "active" ? "text-success border-success/30 bg-success/10" : "text-muted-foreground")}>
                  {b.status}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
                <div><dt className="text-muted-foreground">Markets</dt><dd className="mt-0.5 font-medium">{b.markets.join(", ")}</dd></div>
                <div><dt className="text-muted-foreground">Currencies</dt><dd className="mt-0.5 font-medium">{b.currencies.join(", ")}</dd></div>
                <div><dt className="text-muted-foreground">Stores</dt><dd className="tnum mt-0.5 font-medium">{brandStores.length}</dd></div>
                <div><dt className="text-muted-foreground">Products</dt><dd className="tnum mt-0.5 font-medium">{brandProducts.length}</dd></div>
              </dl>
              {issues.length > 0 && (
                <p className="mt-2 text-[11px] text-warning">{issues.length} open data issue{issues.length > 1 ? "s" : ""} touch this brand&apos;s sources</p>
              )}
            </button>
          );
        })}
      </div>

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (() => {
            const le = legalEntities.find((l) => l.id === selected.legalEntityId);
            const brandStores = stores.filter((s) => s.brandId === selected.id);
            const brandProducts = products.filter((p) => p.brandId === selected.id);
            const brandIntegrations = integrations.filter((i) => i.brandScope.includes(selected.id));
            return (
              <>
                <SheetHeader>
                  <SheetTitle>{selected.name}</SheetTitle>
                  <SheetDescription>{selected.category} · {selected.domains.join(", ")}</SheetDescription>
                </SheetHeader>
                <div className="space-y-4 px-4 pb-6">
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><Building2 className="size-4 text-muted-foreground" aria-hidden />Legal & markets</CardTitle></CardHeader>
                    <CardContent className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Legal entity</span><span>{le?.name}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Registration</span><span className="tnum">{le?.registrationNumber}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Markets / currencies</span><span>{selected.markets.join(", ")} · {selected.currencies.join(", ")}</span></div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><Store className="size-4 text-muted-foreground" aria-hidden />Stores & channels</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5 text-sm">
                        {brandStores.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-2">
                            <span>{s.name}</span>
                            <span className="text-xs capitalize text-muted-foreground">{s.channelType} · {s.currency}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden />Policies & rules</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">Sender / contact policy</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{selected.senderPolicy}</p>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">Claims policy</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{selected.claimsPolicy}</p>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">Brand rules</div>
                        <ul className="mt-0.5 list-inside list-disc text-xs text-muted-foreground">
                          {selected.rules.map((r) => (<li key={r}>{r}</li>))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-sm">Product eligibility</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {brandProducts.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2">
                            <Link href={`/catalog/products?sku=${p.variants[0]?.sku ?? ""}`} className="text-info underline-offset-2 hover:underline">{p.name}</Link>
                            <Badge variant="outline" className={cn("text-[10px] capitalize", p.reviewState === "approved" ? "text-success border-success/30" : "text-warning border-warning/30")}>
                              {p.reviewState.replace("_", " ")}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><Globe className="size-4 text-muted-foreground" aria-hidden />Integrations & data health</CardTitle></CardHeader>
                    <CardContent className="space-y-1.5">
                      {brandIntegrations.map((i) => (
                        <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                          <Link href={`/integrations/${i.id}`} className="text-muted-foreground underline-offset-2 hover:underline">{i.name}</Link>
                          <FreshnessBadge lastSuccessAt={i.lastSuccessAt} slaMinutes={i.freshnessSlaMinutes} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
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
    <RouteGuard permission="catalog.view">
      <BrandsInner />
    </RouteGuard>
  );
}
