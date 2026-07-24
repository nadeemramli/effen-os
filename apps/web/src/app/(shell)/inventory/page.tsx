"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Boxes, PackageMinus, Sparkles } from "lucide-react";
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
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useActivePersona, usePermission, useSession } from "@/hooks/use-session";
import { formatMoney } from "@/lib/domain/money";
import { RouteGuard } from "@/lib/rbac/guard";
import { dateKey } from "@/lib/seed/clock";
import { useAppStore } from "@/lib/store/provider";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const ADJUST_REASONS = [
  { code: "STOCK_RECEIVED", label: "Stock received (PO)" },
  { code: "STOCKTAKE_VARIANCE", label: "Stocktake variance" },
  { code: "DAMAGED", label: "Damaged / quarantined" },
  { code: "RETURN_RESTOCKED", label: "Return restocked" },
] as const;

function InventoryInner() {
  const session = useSession();
  const persona = useActivePersona();
  const canAdjust = usePermission("orders.approve"); // Operations + HQ
  const products = useAppStore((s) => s.products);
  const brands = useAppStore((s) => s.brands);
  const orders = useAppStore((s) => s.orders);
  const auditEvents = useAppStore((s) => s.auditEvents);
  const adjustStock = useAppStore((s) => s.adjustStock);

  const [adjustSku, setAdjustSku] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<string>("STOCK_RECEIVED");

  /** Units sold per SKU over the trailing 14 days → daily velocity. */
  const velocityBySku = useMemo(() => {
    const cutoff = dateKey(14);
    const map = new Map<string, number>();
    for (const o of orders) {
      if (o.isDraft || o.orderStatus === "cancelled") continue;
      const day = new Date(new Date(o.placedAt).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
      if (day < cutoff) continue;
      for (const it of o.items) {
        map.set(it.sku, (map.get(it.sku) ?? 0) + it.quantity);
      }
    }
    return map;
  }, [orders]);

  const rows = useMemo(
    () =>
      products
        .filter((p) => session.brandId === "all" || p.brandId === session.brandId)
        .flatMap((p) =>
          p.variants.map((v) => {
            const atp = v.onHand - v.reserved;
            const sold14 = velocityBySku.get(v.sku) ?? 0;
            const velocity = sold14 / 14;
            const coverDays = velocity > 0 ? atp / velocity : null;
            const state: "stockout" | "reorder" | "low_cover" | "ok" =
              atp <= 0 ? "stockout" : atp < v.reorderPoint ? "reorder" : coverDays !== null && coverDays < 14 ? "low_cover" : "ok";
            return { product: p, variant: v, atp, sold14, velocity, coverDays, state };
          }),
        )
        .sort((a, b) => {
          const rank = { stockout: 0, reorder: 1, low_cover: 2, ok: 3 } as const;
          return rank[a.state] - rank[b.state];
        }),
    [products, session.brandId, velocityBySku],
  );

  const stockouts = rows.filter((r) => r.state === "stockout");
  const reorder = rows.filter((r) => r.state === "reorder");
  const inventoryValue = rows.reduce((s, r) => s + r.variant.onHand * r.variant.cogs, 0);
  const recentAdjustments = auditEvents.filter((e) => e.action === "inventory.adjusted").slice(0, 6);

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id;

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Inventory"
        description="On-hand, reserved, and available-to-promise per SKU with sales velocity and cover. Adjustments are audited with reason codes."
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "SKUs tracked", value: String(rows.length) },
          { label: "Stockouts", value: String(stockouts.length), tone: stockouts.length > 0 ? "text-destructive" : "" },
          { label: "Below reorder point", value: String(reorder.length), tone: reorder.length > 0 ? "text-warning" : "" },
          { label: "Inventory value (COGS)", value: formatMoney(inventoryValue, "MYR", { compact: true }) },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={cn("tnum mt-0.5 text-lg font-semibold", m.tone)}>{m.value}</div>
          </div>
        ))}
      </section>

      {stockouts.some((r) => r.variant.sku === "VER-TON-100") && (
        <p className="flex items-start gap-2 rounded-md border border-ai/25 bg-ai/10 px-3 py-2 text-xs text-ai">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          VER-TON-100 has been stocked out for 12 days and is still advertised — Prophit recommendation{" "}
          <Link href="/prophit" className="underline underline-offset-2">REC-0033</Link> proposes the restock decision.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Boxes className="size-4 text-muted-foreground" aria-hidden />
            Stock by SKU
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            ATP = on hand − reserved. Velocity from the trailing 14 days of orders; cover = ATP ÷ velocity.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">SKU</th>
                  <th className="pb-2 font-medium">Brand</th>
                  <th className="pb-2 text-right font-medium">On hand</th>
                  <th className="pb-2 text-right font-medium">Reserved</th>
                  <th className="pb-2 text-right font-medium">ATP</th>
                  <th className="pb-2 text-right font-medium">Sold 14d</th>
                  <th className="pb-2 text-right font-medium">Cover</th>
                  <th className="pb-2 font-medium">State</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, variant, atp, sold14, coverDays, state }) => (
                  <tr key={variant.sku} className="border-b last:border-0">
                    <td className="py-2">
                      <Link href={`/catalog/products?sku=${variant.sku}`} className="tnum text-info underline-offset-2 hover:underline">
                        {variant.sku}
                      </Link>
                      <div className="max-w-52 truncate text-[11px] text-muted-foreground">
                        {product.name} — {variant.name}
                      </div>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{brandName(product.brandId)}</td>
                    <td className="tnum py-2 text-right">{variant.onHand}</td>
                    <td className="tnum py-2 text-right text-muted-foreground">{variant.reserved}</td>
                    <td className={cn("tnum py-2 text-right font-medium", atp <= 0 && "text-destructive")}>{atp}</td>
                    <td className="tnum py-2 text-right">{sold14}</td>
                    <td className="tnum py-2 text-right">
                      {coverDays === null ? <span className="text-muted-foreground">—</span> : `${Math.round(coverDays)}d`}
                    </td>
                    <td className="py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          state === "stockout" && "border-destructive/30 bg-destructive/10 text-destructive",
                          state === "reorder" && "border-warning/30 bg-warning/10 text-warning",
                          state === "low_cover" && "border-warning/30 bg-warning/10 text-warning",
                          state === "ok" && "text-muted-foreground",
                        )}
                      >
                        {state === "stockout" ? "Stocked out" : state === "reorder" ? "Below reorder pt" : state === "low_cover" ? "Low cover" : "OK"}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">
                      {canAdjust ? (
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => { setAdjustSku(variant.sku); setDelta(""); }}>
                          Adjust
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Ops only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <PackageMinus className="size-4 text-muted-foreground" aria-hidden />
            Recent adjustments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentAdjustments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No manual adjustments this session. Adjustments post here and to the audit trail with a reason code —
              the full movement ledger (receipts, put-away, stocktakes) arrives with the S3 inventory spine.
            </p>
          ) : (
            <ul className="divide-y">
              {recentAdjustments.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span className="tnum text-[11px] text-muted-foreground">{formatRelative(e.at)}</span>
                  <span className="font-medium">{e.entityRef.replace("sku:", "")}</span>
                  <span className="text-muted-foreground">{e.detail}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{e.actorName}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* adjust dialog */}
      <Dialog open={adjustSku !== null} onOpenChange={(o) => !o && setAdjustSku(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust stock — {adjustSku}</DialogTitle>
            <DialogDescription>
              Posts an audited adjustment with a reason code. Use negative numbers for write-offs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="adj-delta">Quantity change</Label>
              <Input id="adj-delta" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 200 or -6" />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADJUST_REASONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustSku(null)}>Cancel</Button>
            <Button
              disabled={!delta || Number.isNaN(Number(delta)) || Number(delta) === 0}
              onClick={() => {
                adjustStock(adjustSku!, Number(delta), reason, persona.name);
                toast.success(`${adjustSku} adjusted by ${Number(delta) > 0 ? "+" : ""}${delta}`, {
                  description: `${ADJUST_REASONS.find((r) => r.code === reason)?.label} · audited`,
                });
                setAdjustSku(null);
              }}
            >
              Post adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

export default function InventoryPage() {
  return (
    <RouteGuard permission="catalog.view">
      <InventoryInner />
    </RouteGuard>
  );
}
