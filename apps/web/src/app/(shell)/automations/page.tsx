"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MessageSquareText, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ImpactPreviewDialog } from "@/components/dialogs/impact-preview-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useActivePersona, usePermission, useSession } from "@/hooks/use-session";
import type { AutomationRule } from "@/lib/domain/types";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

function AutomationsInner() {
  const session = useSession();
  const persona = useActivePersona();
  const canToggle = usePermission("orders.approve");
  const rules = useAppStore((s) => s.automationRules);
  const templates = useAppStore((s) => s.notificationTemplates);
  const orderEvents = useAppStore((s) => s.orderEvents);
  const brands = useAppStore((s) => s.brands);
  const personas = useAppStore((s) => s.personas);
  const toggleAutomationRule = useAppStore((s) => s.toggleAutomationRule);
  const [confirmToggle, setConfirmToggle] = useState<AutomationRule | null>(null);

  /** Rule executions are computed from the same events the order timelines show. */
  const ruleStats = useMemo(() => {
    const map = new Map<string, { runs: number; lastAt: string | null; lastMessage: string | null }>();
    for (const rule of rules) map.set(rule.id, { runs: 0, lastAt: null, lastMessage: null });
    for (const e of orderEvents) {
      if (e.actorType !== "rule") continue;
      const rule = rules.find((r) => e.actorName.includes(r.id));
      if (!rule) continue;
      const cur = map.get(rule.id)!;
      cur.runs += 1;
      if (!cur.lastAt || e.at > cur.lastAt) {
        cur.lastAt = e.at;
        cur.lastMessage = e.message;
      }
    }
    return map;
  }, [rules, orderEvents]);

  const recentExecutions = useMemo(
    () =>
      orderEvents
        .filter((e) => e.actorType === "rule")
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 10),
    [orderEvents],
  );

  const brandLabel = (scope: string[]) =>
    scope.length === 0
      ? "All brands"
      : scope.map((id) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id).join(", ");

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Automations"
        description="Post-purchase rules and message templates. Every execution is visible on the affected order's evidence timeline — no invisible automation."
      />

      {session.mode === "demo" && (
        <p className="rounded-md border border-ai/25 bg-ai/10 px-3 py-2 text-xs text-ai">
          Demo mode: pausing a rule changes prototype state and is audited, but no live automation exists to stop.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Zap className="size-4 text-warning" aria-hidden />
            Rules
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Run counts are computed from the seeded evidence timelines — the same events you see on each order.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Rule</th>
                  <th className="pb-2 font-medium">Trigger</th>
                  <th className="pb-2 font-medium">Scope</th>
                  <th className="pb-2 font-medium">Owner</th>
                  <th className="pb-2 text-right font-medium">Runs (35d)</th>
                  <th className="pb-2 font-medium">Last execution</th>
                  <th className="pb-2 text-right font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const stats = ruleStats.get(rule.id)!;
                  return (
                    <tr key={rule.id} className={cn("border-b align-top last:border-0", rule.status === "paused" && "opacity-60")}>
                      <td className="max-w-72 py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{rule.id}</span>
                          <span className="font-medium">{rule.name}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{rule.description}</p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{rule.trigger}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">{brandLabel(rule.brandScope)}</td>
                      <td className="py-2.5 pr-3 text-xs">{personas.find((p) => p.id === rule.ownerId)?.name ?? "—"}</td>
                      <td className="tnum py-2.5 pr-3 text-right">{stats.runs}</td>
                      <td className="max-w-56 py-2.5 pr-3 text-xs text-muted-foreground">
                        {stats.lastAt ? (
                          <>
                            <span className="tnum">{formatDateTime(stats.lastAt)}</span>
                            <span className="block truncate">{stats.lastMessage}</span>
                          </>
                        ) : rule.status === "paused" ? (
                          "paused"
                        ) : (
                          "no runs in window"
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <Switch
                          checked={rule.status === "active"}
                          disabled={!canToggle}
                          onCheckedChange={() => setConfirmToggle(rule)}
                          aria-label={`${rule.name} ${rule.status === "active" ? "active" : "paused"}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!canToggle && (
            <p className="mt-2 text-[11px] text-muted-foreground">Pausing rules needs Operations or HQ Admin.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareText className="size-4 text-info" aria-hidden />
              Message templates
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              WhatsApp templates go through Meta review; health-vertical templates get extra scrutiny (Lipidri claims gate).
            </p>
          </CardHeader>
          <CardContent className="divide-y">
            {templates.map((t) => (
              <div key={t.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{t.id}</span>
                  <span className="text-sm font-medium">{t.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      t.status === "approved" && "border-success/30 bg-success/10 text-success",
                      t.status === "pending_review" && "border-warning/30 bg-warning/10 text-warning",
                      t.status === "rejected" && "border-destructive/30 bg-destructive/10 text-destructive",
                    )}
                  >
                    {t.status.replace("_", " ")}
                  </Badge>
                  {t.purpose === "marketing" && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">consent-gated</Badge>
                  )}
                  {t.codVariant && <Badge variant="outline" className="text-[10px] text-muted-foreground">COD variant</Badge>}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {t.channel} · {t.brandIds.length === 0 ? "all brands" : brandLabel(t.brandIds)}
                </div>
                {t.note && <p className="mt-1 text-xs text-muted-foreground">{t.note}</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent rule executions</CardTitle>
            <p className="text-xs text-muted-foreground">The last 10 rule events across all orders.</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recentExecutions.map((e) => (
                <li key={e.id} className="py-2 text-sm first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.actorName}</span>
                    <Link href={`/orders/${e.orderId}`} className="text-xs text-info underline-offset-2 hover:underline">
                      {e.orderId}
                    </Link>
                    <span className="tnum ml-auto text-[11px] text-muted-foreground">{formatDateTime(e.at)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.message}</p>
                  {e.reasonCode && (
                    <span className="mt-1 inline-block rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">
                      {e.reasonCode}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <ImpactPreviewDialog
        open={confirmToggle !== null}
        onOpenChange={(o) => !o && setConfirmToggle(null)}
        title={`${confirmToggle?.status === "active" ? "Pause" : "Resume"} ${confirmToggle?.id} — ${confirmToggle?.name}?`}
        description={confirmToggle?.description ?? ""}
        impact={[
          {
            label: "Rule state",
            value: confirmToggle?.status === "active" ? "active → paused" : "paused → active",
            tone: confirmToggle?.status === "active" ? "warning" : "success",
          },
          {
            label: "While paused",
            value:
              confirmToggle?.id === "R-12"
                ? "every new order waits in manual review"
                : confirmToggle?.id === "W-3"
                  ? "stalled shipments stop raising exceptions"
                  : "matching events pass through untouched",
          },
        ]}
        externalDestination="None in Demo mode — in Live mode this changes the rule engine's behaviour immediately."
        reversibility="Fully reversible — toggle back any time."
        auditNote="Recorded as automation.paused / automation.active with your persona."
        confirmLabel={confirmToggle?.status === "active" ? "Pause rule" : "Resume rule"}
        onConfirm={() => {
          if (confirmToggle) {
            toggleAutomationRule(confirmToggle.id, persona.name);
            toast.success(`${confirmToggle.id} ${confirmToggle.status === "active" ? "paused" : "resumed"}`);
          }
        }}
      />
    </PageBody>
  );
}

export default function AutomationsPage() {
  return (
    <RouteGuard permission="orders.view">
      <AutomationsInner />
    </RouteGuard>
  );
}
