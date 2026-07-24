"use client";

import Link from "next/link";
import { useState } from "react";
import { BadgeDollarSign, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ImpactPreviewDialog } from "@/components/dialogs/impact-preview-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MoneyCell } from "@/components/tables/cells";
import { useActivePersona, usePermission } from "@/hooks/use-session";
import {
  commissionFor,
  commissionRateLabel,
  statementProfit,
  totalCost,
  totalSales,
} from "@/lib/domain/commission";
import { formatMoney } from "@/lib/domain/money";
import type { CommissionStatement } from "@/lib/domain/types";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

const STATUS_META: Record<CommissionStatement["status"], { label: string; className: string }> = {
  processing: { label: "Processing", className: "text-muted-foreground" },
  pending_approval: { label: "Pending approval", className: "border-warning/30 bg-warning/10 text-warning" },
  approved: { label: "Approved", className: "border-info/30 bg-info/10 text-info" },
  released: { label: "Released", className: "border-success/30 bg-success/10 text-success" },
};

const CHANNEL_STATE: Record<string, string> = {
  processed: "text-success",
  processing_required: "text-warning",
  pending: "text-muted-foreground",
  blocked: "text-destructive",
};

function FinanceInner() {
  const persona = useActivePersona();
  const canDecide = usePermission("reports.export"); // Finance + HQ (+ analyst read-only handled below)
  const isFinance = usePermission("finance.fees.view");
  const statements = useAppStore((s) => s.commissionStatements);
  const decideCommission = useAppStore((s) => s.decideCommission);
  const [detail, setDetail] = useState<CommissionStatement | null>(null);
  const [confirm, setConfirm] = useState<{ statement: CommissionStatement; to: "approved" | "released" } | null>(null);

  const ready = statements.filter((s) => s.status !== "processing");
  const totalPayable = ready.reduce(
    (sum, s) => sum + commissionFor(s.tier, statementProfit(s)),
    0,
  );

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Finance — commission run"
        description="Channel pulls → processed net profit → per-person P&L → tiered commission → approval → release. SQL Accounting stays the ledger; this run exports to it."
      />

      <p className="flex items-start gap-2 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Workflow as captured from Finance: products/SKUs are set up in Fullkit; sales pull from Fighter,
        Shopee, Lazada, and TikTok (marketplace files processed to net first); once all channels process,
        net profit totals and commission is computed per person and released.
      </p>

      {/* structure card */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Junior tier</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-1.5 font-medium">Profit (RM)</th><th className="pb-1.5 text-right font-medium">Rate</th></tr></thead>
              <tbody>
                <tr className="border-b"><td className="tnum py-1.5">0 – 9,999.99</td><td className="tnum py-1.5 text-right">0</td></tr>
                <tr className="border-b"><td className="tnum py-1.5">10,000 – 29,999.99</td><td className="tnum py-1.5 text-right">3%</td></tr>
                <tr><td className="tnum py-1.5">30,000+</td><td className="tnum py-1.5 text-right">5% + RM1,000 / RM30,000</td></tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Senior / Manager tier</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-1.5 font-medium">Profit (RM)</th><th className="pb-1.5 text-right font-medium">Rate</th></tr></thead>
              <tbody>
                <tr className="border-b"><td className="tnum py-1.5">0 – 39,999.99</td><td className="tnum py-1.5 text-right">0</td></tr>
                <tr><td className="tnum py-1.5">40,000+</td><td className="tnum py-1.5 text-right">5% + RM1,000 / RM30,000</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-warning">
              Assumption to confirm: rates apply to the whole profit once a bracket is reached (not marginal).
            </p>
          </CardContent>
        </Card>
        <Card className="gap-1.5 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Total payable this run</span>
          <span className="tnum text-2xl font-semibold">{formatMoney(totalPayable, "MYR")}</span>
          <p className="text-[11px] text-muted-foreground">
            {ready.length} of {statements.length} statements ready · 1 still processing (Shopee file blocked by the stale sync)
          </p>
        </Card>
      </div>

      {/* statements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BadgeDollarSign className="size-4 text-muted-foreground" aria-hidden />
            Statements — July 2026 (MTD)
          </CardTitle>
          <p className="text-xs text-muted-foreground">Click a row for the full P&L in the operational structure.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Person</th>
                  <th className="pb-2 font-medium">Tier</th>
                  <th className="pb-2 font-medium">Channels</th>
                  <th className="pb-2 text-right font-medium">Total sales</th>
                  <th className="pb-2 text-right font-medium">Total cost</th>
                  <th className="pb-2 text-right font-medium">Profit</th>
                  <th className="pb-2 text-right font-medium">Commission</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const profit = statementProfit(s);
                  const commission = commissionFor(s.tier, profit);
                  const processing = s.status === "processing";
                  return (
                    <tr
                      key={s.id}
                      className={cn("cursor-pointer border-b last:border-0 hover:bg-accent/40", processing && "opacity-60")}
                      onClick={() => setDetail(s)}
                    >
                      <td className="py-2.5 font-medium">{s.personName}</td>
                      <td className="py-2.5 capitalize text-muted-foreground">{s.tier}</td>
                      <td className="py-2.5">
                        <div className="flex gap-1.5">
                          {s.channels.map((c) => (
                            <span key={c.channel} className={cn("text-[11px]", CHANNEL_STATE[c.state])} title={`${c.channel}: ${c.state.replace(/_/g, " ")}`}>
                              {c.channel}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 text-right">{processing ? "—" : <MoneyCell minor={totalSales(s)} currency="MYR" />}</td>
                      <td className="py-2.5 text-right">{processing ? "—" : <MoneyCell minor={totalCost(s)} currency="MYR" />}</td>
                      <td className="py-2.5 text-right font-medium">{processing ? "—" : <MoneyCell minor={profit} currency="MYR" />}</td>
                      <td className="py-2.5 text-right">
                        {processing ? (
                          <span className="text-xs text-muted-foreground">awaiting channels</span>
                        ) : (
                          <div>
                            <MoneyCell minor={commission} currency="MYR" className={cn("font-semibold", commission === 0 && "text-muted-foreground")} />
                            <div className="text-[10px] text-muted-foreground">{commissionRateLabel(s.tier, profit)}</div>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5">
                        <Badge variant="outline" className={cn("text-[10px]", STATUS_META[s.status].className)}>
                          {STATUS_META[s.status].label}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {canDecide && s.status === "pending_approval" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirm({ statement: s, to: "approved" })}>
                            Approve
                          </Button>
                        )}
                        {canDecide && s.status === "approved" && (
                          <Button size="sm" className="h-7 text-xs" onClick={() => setConfirm({ statement: s, to: "released" })}>
                            Release
                          </Button>
                        )}
                        {!canDecide && s.status === "pending_approval" && (
                          <span className="text-[11px] text-muted-foreground">Finance/HQ approves</span>
                        )}
                        {s.status === "released" && <CheckCircle2 className="ml-auto size-4 text-success" aria-label="Released" />}
                        {s.status === "processing" && (
                          <Link href="/integrations/INT-shopee" className="text-[11px] text-info underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                            unblock source
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!isFinance && (
            <p className="mt-2 text-[11px] text-muted-foreground">Cost lines are summarized — full fee detail is Finance-scoped.</p>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Released statements export to SQL Accounting on the weekly journal bridge — Fullkit computes and
        controls the run; the ledger stays authoritative. Every approve/release is audited.
      </p>

      {/* P&L drawer */}
      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>{detail.personName} — {detail.period}</SheetTitle>
                <SheetDescription>
                  Operational P&L structure (as used in the commission sheets), computed from processed channel pulls.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-1 px-4 pb-6 text-sm">
                {detail.status === "processing" ? (
                  <div className="rounded-md border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
                    Statement incomplete — {detail.channels.filter((c) => c.state !== "processed").map((c) => `${c.channel} (${c.state.replace(/_/g, " ")})`).join(", ")}.
                    Totals appear once every channel processes to net.
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between py-1"><span>Sales (Package)</span><MoneyCell minor={detail.salesPackage} currency="MYR" /></div>
                    <div className="flex justify-between py-1"><span className="text-muted-foreground">(+) COD</span><MoneyCell minor={detail.cod} currency="MYR" /></div>
                    <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">(+) Sabah/Sarawak postage</span><MoneyCell minor={detail.ssPostage} currency="MYR" /></div>
                    <div className="flex justify-between py-1 font-medium"><span>Total Sales</span><MoneyCell minor={totalSales(detail)} currency="MYR" /></div>
                    <div className="pt-2 text-xs font-medium text-muted-foreground">(−) Cost</div>
                    <div className="flex justify-between py-1"><span className="text-muted-foreground">Product</span><MoneyCell minor={detail.productCost} currency="MYR" /></div>
                    <div className="flex justify-between py-1"><span className="text-muted-foreground">Delivery cost</span><MoneyCell minor={detail.deliveryCost} currency="MYR" /></div>
                    <div className="flex justify-between py-1"><span className="text-muted-foreground">Return cost</span><MoneyCell minor={detail.returnCost} currency="MYR" /></div>
                    <div className="flex justify-between py-1"><span className="text-muted-foreground">COD cost</span><MoneyCell minor={detail.codCost} currency="MYR" /></div>
                    <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Marketing cost</span><MoneyCell minor={detail.marketingCost} currency="MYR" /></div>
                    <div className="flex justify-between py-1 font-medium"><span>Total Cost</span><MoneyCell minor={totalCost(detail)} currency="MYR" /></div>
                    <div className="mt-2 flex justify-between rounded-md bg-muted px-3 py-2 font-semibold">
                      <span>Profit</span>
                      <MoneyCell minor={statementProfit(detail)} currency="MYR" />
                    </div>
                    <div className="flex justify-between rounded-md border border-success/25 bg-success/5 px-3 py-2 font-semibold text-success">
                      <span>Commission ({commissionRateLabel(detail.tier, statementProfit(detail))})</span>
                      <MoneyCell minor={commissionFor(detail.tier, statementProfit(detail))} currency="MYR" />
                    </div>
                  </>
                )}
                <div className="pt-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Channel pulls</div>
                  <ul className="space-y-1">
                    {detail.channels.map((c) => (
                      <li key={c.channel} className="flex items-baseline justify-between gap-2 text-xs">
                        <span>{c.channel}</span>
                        <span className={cn("capitalize", CHANNEL_STATE[c.state])}>{c.state.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                  {detail.channels.some((c) => c.note) && (
                    <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                      {detail.channels.filter((c) => c.note).map((c) => (<li key={c.channel}>{c.channel}: {c.note}</li>))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* approve / release */}
      <ImpactPreviewDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.to === "approved"
            ? `Approve ${confirm.statement.personName}'s statement?`
            : `Release ${confirm?.statement.personName}'s commission?`
        }
        description={
          confirm?.to === "approved"
            ? "Locks the computed P&L and commission for this period."
            : "Marks the commission payable and queues it for the SQL Accounting export."
        }
        impact={
          confirm
            ? [
                { label: "Profit", value: formatMoney(statementProfit(confirm.statement), "MYR") },
                {
                  label: "Commission",
                  value: formatMoney(commissionFor(confirm.statement.tier, statementProfit(confirm.statement)), "MYR"),
                  tone: "success",
                },
                { label: "Tier basis", value: commissionRateLabel(confirm.statement.tier, statementProfit(confirm.statement)) },
              ]
            : []
        }
        externalDestination={
          confirm?.to === "released"
            ? "Queued for the weekly SQL Accounting journal export (Demo mode: recorded only)."
            : "None — approval is internal."
        }
        reversibility={confirm?.to === "approved" ? "Reversible until released." : "Reversal requires a correcting journal entry."}
        auditNote="Recorded as commission.approved / commission.released with your persona."
        confirmLabel={confirm?.to === "approved" ? "Approve statement" : "Release commission"}
        onConfirm={() => {
          if (confirm) {
            decideCommission(confirm.statement.id, confirm.to, persona.name);
            toast.success(`${confirm.statement.personName}: ${confirm.to}`);
          }
        }}
      />
    </PageBody>
  );
}

export default function FinancePage() {
  return (
    <RouteGuard permission="finance.fees.view">
      <FinanceInner />
    </RouteGuard>
  );
}
