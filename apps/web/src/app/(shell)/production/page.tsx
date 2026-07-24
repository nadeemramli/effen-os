"use client";

import { useState } from "react";
import { Factory, FlaskConical, PackageCheck } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useActivePersona, usePermission, useSession } from "@/hooks/use-session";
import type { WorkOrder } from "@/lib/domain/types";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatDate, formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const STAGES = ["planned", "materials", "production", "qc", "fg_received"] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  planned: "Planned",
  materials: "Materials issued",
  production: "In production",
  qc: "QC",
  fg_received: "FG received",
};
const NEXT_LABEL: Record<string, string> = {
  planned: "Issue materials",
  materials: "Start production",
  production: "Send to QC",
  qc: "Receive finished goods",
};

function ProductionInner() {
  const session = useSession();
  const persona = useActivePersona();
  const canAct = usePermission("orders.approve"); // Operations + HQ
  const workOrders = useAppStore((s) => s.workOrders);
  const brands = useAppStore((s) => s.brands);
  const advanceWorkOrder = useAppStore((s) => s.advanceWorkOrder);
  const setWorkOrderQc = useAppStore((s) => s.setWorkOrderQc);
  const [holdWo, setHoldWo] = useState<WorkOrder | null>(null);
  const [holdReason, setHoldReason] = useState("");

  const scoped = workOrders.filter((w) => session.brandId === "all" || w.brandId === session.brandId);
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id;

  const open = scoped.filter((w) => w.stage !== "fg_received").length;
  const onHold = scoped.filter((w) => w.qcState === "hold").length;
  const blocked = scoped.filter((w) => w.blockedBy).length;

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Production"
        description="Work orders from demand to finished-goods receipt: BOM check, batch, yield, QC. FG receipt lands stock into sellable inventory."
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Open work orders", value: String(open) },
          { label: "QC holds", value: String(onHold), tone: onHold > 0 ? "text-warning" : "" },
          { label: "Material-blocked", value: String(blocked), tone: blocked > 0 ? "text-warning" : "" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={cn("tnum mt-0.5 text-lg font-semibold", m.tone)}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {scoped.map((wo) => {
          const shortfall = wo.bom.filter((line) => line.onHand < line.perUnit * wo.quantity);
          return (
            <Card key={wo.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Factory className="size-4 text-muted-foreground" aria-hidden />
                    {wo.id} — {wo.productName}
                    <span className="tnum text-xs font-normal text-muted-foreground">×{wo.quantity.toLocaleString()}</span>
                    <Badge variant="outline" className="text-[10px]">{brandName(wo.brandId)}</Badge>
                    {wo.qcState === "hold" && (
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">QC hold</Badge>
                    )}
                  </CardTitle>
                  <p className="tnum mt-0.5 text-xs text-muted-foreground">
                    Batch {wo.batchNo} · expiry {formatDate(wo.expiryDate)} · due {formatRelative(wo.dueAt)}
                    {wo.yieldPct !== null && ` · yield ${wo.yieldPct}%`}
                  </p>
                </div>
                {canAct && wo.stage !== "fg_received" && !(wo.stage === "qc" && wo.qcState !== "passed") && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs"
                    disabled={Boolean(wo.blockedBy) && wo.stage === "planned"}
                    onClick={() => {
                      advanceWorkOrder(wo.id, persona.name);
                      toast.success(`${wo.id} → ${STAGES[STAGES.indexOf(wo.stage) + 1]}`, {
                        description: wo.stage === "qc" ? "Finished goods received into sellable stock (S3 spine will post the movement)." : undefined,
                      });
                    }}
                  >
                    {NEXT_LABEL[wo.stage]}
                  </Button>
                )}
                {canAct && wo.stage === "qc" && wo.qcState !== "passed" && (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm" className="h-7 text-xs"
                      onClick={() => {
                        setWorkOrderQc(wo.id, "passed", null, persona.name);
                        toast.success(`${wo.id} QC passed`);
                      }}
                    >
                      QC pass
                    </Button>
                    {wo.qcState !== "hold" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-warning" onClick={() => { setHoldWo(wo); setHoldReason(""); }}>
                        Hold
                      </Button>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-2.5">
                {/* stage strip */}
                <ol className="flex flex-wrap items-center gap-1">
                  {STAGES.map((s, i) => (
                    <li key={s} className="flex items-center gap-1">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          s === wo.stage
                            ? "bg-primary text-primary-foreground"
                            : STAGES.indexOf(wo.stage) > i
                              ? "bg-success/12 text-success"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {STAGE_LABEL[s]}
                      </span>
                      {i < STAGES.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
                    </li>
                  ))}
                </ol>

                {wo.blockedBy && (
                  <p className="rounded-md border border-warning/25 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                    Blocked: {wo.blockedBy}
                  </p>
                )}
                {wo.qcState === "hold" && wo.qcReason && (
                  <p className="flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                    <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {wo.qcReason}
                  </p>
                )}

                {/* BOM */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-1 font-medium">Material (BOM)</th>
                      <th className="pb-1 text-right font-medium">Per unit</th>
                      <th className="pb-1 text-right font-medium">Required</th>
                      <th className="pb-1 text-right font-medium">On hand</th>
                      <th className="pb-1 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wo.bom.map((line) => {
                      const required = Math.ceil(line.perUnit * wo.quantity);
                      const balance = line.onHand - required;
                      return (
                        <tr key={line.material} className="border-b last:border-0">
                          <td className="py-1">{line.material}</td>
                          <td className="tnum py-1 text-right">{line.perUnit} {line.uom}</td>
                          <td className="tnum py-1 text-right">{required.toLocaleString()}</td>
                          <td className="tnum py-1 text-right">{line.onHand.toLocaleString()}</td>
                          <td className={cn("tnum py-1 text-right font-medium", balance < 0 ? "text-destructive" : "text-success")}>
                            {balance >= 0 ? "+" : ""}{balance.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shortfall.length > 0 && wo.stage === "planned" && (
                  <p className="text-[11px] text-muted-foreground">
                    Cannot issue materials while any BOM line is short — MRP proposes the purchase (supplier POs arrive with the P5 spine).
                  </p>
                )}
                {wo.stage === "fg_received" && (
                  <p className="flex items-center gap-1.5 text-[11px] text-success">
                    <PackageCheck className="size-3.5" aria-hidden />
                    Received into sellable stock — batch {wo.batchNo}, yield {wo.yieldPct}%.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!canAct && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Work-order actions need Operations or HQ Admin.
        </p>
      )}

      {/* QC hold dialog */}
      <Dialog open={holdWo !== null} onOpenChange={(o) => !o && setHoldWo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QC hold — {holdWo?.id}</DialogTitle>
            <DialogDescription>The batch stays out of sellable stock until the hold is resolved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="hold-reason">Reason (recorded)</Label>
            <Textarea id="hold-reason" rows={2} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="e.g. Seal integrity failure on sample check" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldWo(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!holdReason.trim()}
              onClick={() => {
                setWorkOrderQc(holdWo!.id, "hold", holdReason.trim(), persona.name);
                toast.warning(`${holdWo!.id} on QC hold`);
                setHoldWo(null);
              }}
            >
              Place hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

export default function ProductionPage() {
  return (
    <RouteGuard permission="catalog.view">
      <ProductionInner />
    </RouteGuard>
  );
}
