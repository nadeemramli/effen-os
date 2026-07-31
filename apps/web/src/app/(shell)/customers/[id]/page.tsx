"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { EmptyState } from "@/components/states";
import {
  fetchLiveBrands,
  fetchLiveCustomerDetail,
  type LiveBrand,
  type LiveCustomerDetail,
} from "@/lib/supabase/live";
import { maskEmail, maskPhone } from "@/lib/utils/mask";
import { cn } from "@/lib/utils";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
}

function money(ccy: string, v: number): string {
  return `${ccy === "MYR" ? "RM" : ccy === "SGD" ? "S$" : ccy} ${Number(v).toLocaleString("en-MY", { maximumFractionDigits: 2 })}`;
}

function CustomerDetailInner() {
  const params = useParams<{ id: string }>();
  const identityKey = decodeURIComponent(params.id);

  const [detail, setDetail] = useState<LiveCustomerDetail | null | "loading">("loading");
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [showPii, setShowPii] = useState(false);

  useEffect(() => {
    // Fetch-on-mount; every setState happens after an await.
    void (async () => {
      const [d, b] = await Promise.all([fetchLiveCustomerDetail(identityKey), fetchLiveBrands()]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(d);
      setBrands(b);
    })();
  }, [identityKey]);

  const brandName = useMemo(
    () => (id: number | null) => brands.find((b) => b.id === id)?.name ?? (id === null ? "unmapped" : String(id)),
    [brands],
  );

  if (detail === "loading") {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading customer" />
      </PageBody>
    );
  }

  if (!detail) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Customer not found"
          description="This identity is not in the read-model. It refreshes every 15 minutes — a very recent first-time buyer may not have landed yet."
          action={{ label: "Back to customers", href: "/customers" }}
        />
      </PageBody>
    );
  }

  const p = detail.profile;
  const revenue = Object.entries(p.revenue_by_currency ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const aov = revenue.map(([ccy, v]) => {
    const recognized = Number(p.recognized_orders) || 1;
    return [ccy, Number(v) / recognized] as const;
  });

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title={p.display_name ?? "Unknown customer"}
        description={`Identity resolved from order history (${p.phone ? "phone" : "e-mail"}-keyed) · live mirror · PII ${showPii ? "visible" : "masked"}`}
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPii((v) => !v)}>
            {showPii ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {showPii ? "Mask PII" : "Reveal PII"}
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/customers"><ArrowLeft className="size-3.5" aria-hidden /> Customers</Link>
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* identity */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Identity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Phone</span>
              <span className="tnum">{p.phone ? maskPhone(p.phone, showPii) : "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">E-mail</span>
              <span className="truncate">{p.email ? maskEmail(p.email, showPii) : "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Location</span>
              <span>{[p.city, p.country].filter(Boolean).join(", ") || "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Brands</span>
              <span className="text-right">{(p.brand_ids ?? []).map((id) => brandName(id)).join(", ") || "—"}</span>
            </div>
            <p className="border-t pt-2 text-xs text-muted-foreground">
              Provenance: WooCommerce billing details from the connected stores. Consent state is not yet
              captured — no channel consents are on file, so treat marketing contact as not permitted.
            </p>
          </CardContent>
        </Card>

        {/* value */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Value</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Orders (all states)</span>
              <span className="tnum">{p.total_orders}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Recognized orders</span>
              <span className="tnum">{p.recognized_orders}</span>
            </div>
            {revenue.map(([ccy, v]) => (
              <div key={ccy} className="flex justify-between gap-2">
                <span className="text-muted-foreground">Recognized revenue ({ccy})</span>
                <span className="tnum">{money(ccy, Number(v))}</span>
              </div>
            ))}
            {aov.map(([ccy, v]) => (
              <div key={ccy} className="flex justify-between gap-2">
                <span className="text-muted-foreground">AOV ({ccy})</span>
                <span className="tnum">{money(ccy, v)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-2 border-t pt-2">
              <span className="text-muted-foreground">First order</span>
              <span className="tnum">{fmtDateTime(p.first_order_at)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Last order</span>
              <span className="tnum">{fmtDateTime(p.last_order_at)}</span>
            </div>
          </CardContent>
        </Card>

        {/* conversations */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Conversations</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-4 text-muted-foreground" aria-hidden />
              <span className="tnum">{detail.wa_conversations}</span>
              <span className="text-muted-foreground">WhatsApp conversation{detail.wa_conversations === 1 ? "" : "s"} linked</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Matched by phone against the WhatsApp Cloud API mirror. Capture starts from webhook
              connection — there is no history backfill in the Cloud API.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* order history */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Order history</CardTitle>
          <Badge variant="outline" className="tnum text-xs">{detail.orders.length}{detail.orders.length === 100 ? "+" : ""}</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Order</th>
                  <th className="px-2 py-1.5 font-medium">Brand</th>
                  <th className="px-2 py-1.5 font-medium">Items</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 text-right font-medium">Total</th>
                  <th className="px-2 py-1.5 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="tnum px-2 py-1.5 font-medium">#{o.order_number ?? o.source_order_id}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{brandName(o.brand_id)}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {(o.items ?? []).slice(0, 2).map((i) => `${i.sku ?? i.name} ×${i.quantity}`).join(", ")}
                      {(o.items?.length ?? 0) > 2 && ` +${o.items.length - 2}`}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] capitalize",
                          o.source_status === "completed" ? "border-success/30 text-success"
                            : o.source_status === "cancelled" || o.source_status === "failed" ? "border-destructive/30 text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {o.source_status}
                      </Badge>
                    </td>
                    <td className="tnum px-2 py-1.5 text-right">{o.currency_code} {Number(o.total).toFixed(2)}</td>
                    <td className="tnum px-2 py-1.5 text-xs text-muted-foreground">{fmtDateTime(o.placed_at)}</td>
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

export default function CustomerDetailPage() {
  return (
    <LiveGuard>
      <CustomerDetailInner />
    </LiveGuard>
  );
}
