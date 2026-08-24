"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/components/shell/page-header";
import { tonePill } from "@/components/status/status-pill";
import { EmptyState, ErrorState } from "@/components/states";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLiveBrands,
  fetchLiveCustomerDetail,
  type LiveBrand,
  type LiveCustomerDetail,
} from "@/lib/supabase/live";
import { FX_TO_MYR } from "@/lib/domain/metrics";
import { maskEmail, maskPhone } from "@/lib/utils/mask";
import { cn } from "@/lib/utils";

/* Original Customer 360 layout, fed by the live identity read-model.
 * Fields whose sources are not yet connected state so instead of faking. */

function relative(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
}

function lifecycle(last: string | null): string {
  if (!last) return "provisional";
  const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
  if (days <= 30) return "active";
  if (days <= 90) return "at risk";
  return "dormant";
}

function tierOf(revenue: Record<string, number> | null): string {
  const total = Object.values(revenue ?? {}).reduce((s, v) => s + Number(v), 0);
  // Thresholds calibrated to the live value distribution (p99/p95/p75).
  return total >= 900 ? "vip" : total >= 600 ? "high" : total >= 230 ? "mid" : "low";
}

function moneyMyr(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 10_000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return `${v < 0 ? "−" : ""}RM ${s}`;
}

/** Contribution LTV in MYR: revenue converted at the app FX, minus variable costs. */
function contributionLtv(c: LiveCustomerDetail["contribution"] | undefined): { value: string; estimated: boolean } {
  if (!c || c.orders === 0) return { value: "—", estimated: false };
  const revMyr = Object.entries(c.revenue_by_currency ?? {}).reduce(
    (s, [ccy, v]) => s + Number(v) * (FX_TO_MYR[ccy] ?? 1), 0);
  const ltv = revMyr - Number(c.cogs_myr) - Number(c.delivery_myr) - Number(c.cod_myr);
  // Modeled costs with unmapped SKU lines understate COGS — flag as estimate.
  return { value: moneyMyr(ltv), estimated: c.unmapped_lines > 0 };
}

/** COD share + return rate; the label needs enough orders to mean anything. */
function riskLine(r: LiveCustomerDetail["risk"] | undefined): string {
  if (!r || r.total_orders === 0) return "—";
  const codPct = Math.round((r.cod_orders / r.total_orders) * 100);
  const rtsPct = Math.round((r.returned_orders / r.total_orders) * 100);
  const label = r.total_orders < 3 ? "low signal"
    : rtsPct >= 25 ? "high" : rtsPct >= 10 ? "elevated" : "low";
  return `${label} · ${rtsPct}% returned · ${codPct}% COD`;
}

function revenueLine(byCcy: Record<string, number> | null): string {
  const parts = Object.entries(byCcy ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => `${c === "MYR" ? "RM" : c === "SGD" ? "S$" : c} ${Number(v) >= 10_000 ? `${(Number(v) / 1000).toFixed(1)}k` : Number(v).toFixed(0)}`);
  return parts.join(" + ") || "—";
}

const ORDER_PILLS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "destructive" | "info" }[]> = {
  pending: [{ label: "Awaiting payment", tone: "warning" }, { label: "Unpaid", tone: "neutral" }],
  "on-hold": [{ label: "On hold", tone: "warning" }],
  processing: [{ label: "Paid", tone: "success" }, { label: "To fulfil", tone: "info" }],
  completed: [{ label: "Completed", tone: "success" }, { label: "Paid", tone: "success" }],
  cancelled: [{ label: "Cancelled", tone: "neutral" }],
  refunded: [{ label: "Refunded", tone: "neutral" }],
  failed: [{ label: "Payment failed", tone: "destructive" }],
};

function CustomerDetailInner() {
  const params = useParams<{ id: string }>();
  const identityKey = decodeURIComponent(params.id);

  const [detail, setDetail] = useState<LiveCustomerDetail | null | "loading">("loading");
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Fetch-on-mount; every setState happens after an await.
    void (async () => {
      try {
        const [d, b] = await Promise.all([fetchLiveCustomerDetail(identityKey), fetchLiveBrands()]);
        setDetail(d);
        setBrands(b);
      } catch (e) {
        // Without this the page would sit on the skeleton forever.
        setError((e as Error).message);
      }
    })();
  }, [identityKey, reloadKey]);

  const purchasedSkus = useMemo(() => {
    if (detail === "loading" || !detail) return [] as [string, { qty: number; last: string | null; name: string | null }][];
    const map = new Map<string, { qty: number; last: string | null; name: string | null }>();
    for (const o of detail.orders) {
      for (const it of o.items ?? []) {
        const key = it.sku ?? it.name ?? "—";
        const cur = map.get(key) ?? { qty: 0, last: null, name: it.name };
        cur.qty += Number(it.quantity ?? 0);
        if (!cur.last || (o.placed_at && o.placed_at > cur.last)) cur.last = o.placed_at;
        map.set(key, cur);
      }
    }
    return [...map.entries()].sort(([, a], [, b]) => b.qty - a.qty);
  }, [detail]);

  if (error) {
    return (
      <PageBody className="max-w-3xl">
        <ErrorState
          title="Could not load this customer"
          description={error}
          retry={() => {
            setError(null);
            setDetail("loading");
            setReloadKey((k) => k + 1);
          }}
        />
      </PageBody>
    );
  }

  if (detail === "loading") {
    // Header line + value strip + card grid mirror the loaded layout.
    return (
      <PageBody className="max-w-none">
        <div role="status" aria-label="Loading customer" className="space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to customers">
                <Link href="/customers"><ArrowLeft className="size-4" /></Link>
              </Button>
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-4 w-72" />
          </div>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-2.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="mt-1.5 h-5 w-16" />
              </div>
            ))}
          </section>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-28" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </PageBody>
    );
  }

  if (!detail) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Customer not found"
          description="No resolved identity with this key. The read-model refreshes every 15 minutes — a very recent first-time buyer may not have landed yet."
          action={{ label: "Back to customers", href: "/customers" }}
        />
      </PageBody>
    );
  }

  const p = detail.profile;
  const brandName = (id: number) => brands.find((b) => b.id === id)?.name ?? String(id);
  const tier = tierOf(p.revenue_by_currency);
  const lc = lifecycle(p.last_order_at);
  const repeat = Number(p.total_orders) >= 5 ? "loyal" : Number(p.total_orders) > 1 ? "repeat" : "first-time";
  const ltv = contributionLtv(detail.contribution);

  return (
    <PageBody className="max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to customers">
              <Link href="/customers"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">{p.display_name ?? "Unknown customer"}</h1>
            <Badge variant="outline" className="capitalize">{lc}</Badge>
            <Badge variant="outline" className="uppercase">{tier}</Badge>
            {Number(p.shared_address_count ?? 0) >= 2 && (
              <Badge variant="outline" className="tnum text-muted-foreground">×{p.shared_address_count} at address</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {identityKey.startsWith("a:") ? "address-keyed" : identityKey.includes("@") ? "e-mail-keyed" : "phone-keyed"} ·{" "}
            {p.country ?? "—"} · first order {relative(p.first_order_at)} · owner:{" "}
            unassigned
          </p>
        </div>
      </div>

      {/* value strip */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          { label: "Lifetime orders", value: String(p.total_orders) },
          { label: "Recognized revenue", value: revenueLine(p.revenue_by_currency) },
          { label: ltv.estimated ? "Contribution LTV (est.)" : "Contribution LTV", value: ltv.value },
          { label: "Last order", value: relative(p.last_order_at) },
          { label: "Repeat state", value: repeat },
          { label: "COD / return risk", value: riskLine(detail.risk) },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className="tnum mt-0.5 text-base font-semibold capitalize">{m.value}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* order timeline */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Orders</CardTitle></CardHeader>
            <CardContent>
              {detail.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders linked to this identity yet.</p>
              ) : (
                <ul className="divide-y">
                  {detail.orders.map((o) => (
                    <li key={o.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/orders/${o.id}`} className="font-medium text-info underline-offset-2 hover:underline">
                          #{o.order_number ?? o.source_order_id}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {o.brand_id ? brandName(o.brand_id) : "unmapped"} · woocommerce · {fmtDate(o.placed_at)}
                        </span>
                        <span className="tnum ml-auto text-sm font-medium">
                          {o.currency_code} {Number(o.total).toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(ORDER_PILLS[o.source_status] ?? [{ label: o.source_status, tone: "neutral" as const }]).map((pl, i) => (
                          <span key={i}>{tonePill(pl)}</span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* delivery address — latest order, Fullkit corrections applied */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Delivery address</CardTitle>
              <p className="text-xs text-muted-foreground">
                From the most recent order{detail.address?.order_number ? ` (#${detail.address.order_number})` : ""} —
                shipping first, billing fallback{detail.address?.corrected ? "; a Fullkit shipping correction is applied" : ""}.
              </p>
            </CardHeader>
            <CardContent>
              {detail.address ? (
                <address className="space-y-0.5 text-sm not-italic">
                  <div className="font-medium">{detail.address.name ?? p.display_name ?? "—"}</div>
                  {detail.address.address_1 && <div>{detail.address.address_1}</div>}
                  {detail.address.address_2 && <div>{detail.address.address_2}</div>}
                  <div>
                    {[detail.address.postcode, detail.address.city, detail.address.state]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </div>
                  <div className="text-muted-foreground">{detail.address.country ?? "—"}</div>
                  {detail.address.phone && (
                    <div className="tnum pt-1 text-xs text-muted-foreground">{detail.address.phone}</div>
                  )}
                </address>
              ) : (
                <p className="text-sm text-muted-foreground">No orders yet — no address on record.</p>
              )}
            </CardContent>
          </Card>

          {/* address siblings — the reseller / drop-point linking layer */}
          {(detail.address_siblings ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium">Same address</CardTitle>
                  <Badge variant="outline" className="tnum text-[10px]">
                    ×{p.shared_address_count ?? (detail.address_siblings.length + 1)} profiles
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Other customer profiles whose latest order ships to this normalized address — a reseller /
                  drop-point signal. Profiles are never merged.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {detail.address_siblings.map((s) => (
                    <li key={s.identity_key} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                      <Link
                        href={`/customers/${encodeURIComponent(s.identity_key)}`}
                        className="font-medium text-info underline-offset-2 hover:underline"
                      >
                        {s.display_name ?? s.identity_key}
                      </Link>
                      {s.classification === "reseller" && (
                        <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] text-info">reseller</Badge>
                      )}
                      {s.classification === "joy_buyer" && (
                        <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">joy buyer</Badge>
                      )}
                      <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="tnum">{s.total_orders} order{Number(s.total_orders) === 1 ? "" : "s"}</span>
                        <span className="tnum">rev {Number(s.revenue_total).toFixed(0)}</span>
                        <span className="tnum">last {fmtDate(s.last_order_at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* conversation & activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Conversation & activity</CardTitle>
              <p className="text-xs text-muted-foreground">Human touches and chat intake events across this customer&apos;s orders.</p>
            </CardHeader>
            <CardContent>
              {detail.wa_conversations > 0 ? (
                <p className="text-sm">
                  <span className="tnum font-medium">{detail.wa_conversations}</span>{" "}
                  WhatsApp conversation{detail.wa_conversations === 1 ? "" : "s"} linked by phone.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No conversation events recorded — capture starts when the WhatsApp Cloud API webhook connects
                  (no history backfill exists).
                </p>
              )}
            </CardContent>
          </Card>

          {/* purchased products */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Purchased products & replenishment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {purchasedSkus.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                <ul className="divide-y">
                  {purchasedSkus.map(([sku, info]) => (
                    <li key={sku} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm">
                      <span className="tnum">{sku}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{info.name ?? ""}</span>
                      <span className="tnum text-xs text-muted-foreground">×{info.qty} · last {relative(info.last)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                Replenishment cues arrive once product cadence baselines are governed in the catalog.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {/* identity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                Resolved identity
                <span className="tnum text-xs font-normal text-muted-foreground">billing-keyed</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {p.phone && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="tnum flex items-center gap-1.5">
                    {maskPhone(p.phone, false)}
                    <ShieldCheck className="size-3.5 text-success" aria-label="verified by order history" />
                  </span>
                </div>
              )}
              {p.email && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Email</span>
                  <span className="truncate">{maskEmail(p.email, false)}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Location</span>
                <span>{[p.city, p.country].filter(Boolean).join(", ") || "—"}</span>
              </div>
              <p className="pt-1 text-[11px] text-muted-foreground">
                Contact details are masked by default.
              </p>
              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                Phone-keyed identity resolved from WooCommerce billing data across all connected stores.
              </p>
            </CardContent>
          </Card>

          {/* consent */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Consent & suppression</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {["whatsapp · marketing", "email · marketing"].map((c) => (
                <div key={c} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-muted-foreground">{c}</span>
                  <span className="text-xs font-medium text-muted-foreground">not captured</span>
                </div>
              ))}
              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                No consent source is connected yet — treat marketing contact as not permitted. Transactional
                messages still deliver.
              </p>
            </CardContent>
          </Card>

          {/* segments / journeys */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Segments & journeys</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-xs capitalize">{repeat}</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{lc}</Badge>
                {(p.brand_ids ?? []).length > 1 && <Badge variant="secondary" className="text-xs">cross-brand</Badge>}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Derived from order history; governed segments and journey memberships arrive with the CDP read-side.
              </p>
            </CardContent>
          </Card>

          {/* provenance */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Data provenance</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>WooCommerce billing (all stores)</span>
                <span className={cn("font-medium", "text-success")}>15-min refresh</span>
              </div>
              <p>
                Identity, value, and order history come straight from the connected store mirrors and refresh
                every 15 minutes. Conversation and consent sources are not yet connected.
              </p>
              <Link href="/settings/setup/connections" className="text-info underline-offset-2 hover:underline">
                View connections
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}

export default function CustomerDetailPage() {
  return (
    <LiveGuard>
      <CustomerDetailInner />
    </LiveGuard>
  );
}
