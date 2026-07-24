"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Flame, Palette, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImpactPreviewDialog } from "@/components/dialogs/impact-preview-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useActivePersona, usePermission, useSession } from "@/hooks/use-session";
import type { CreativeBrief } from "@/lib/domain/types";
import { CREATIVE_DEMAND } from "@/lib/seed/data/ops-modules";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const STAGES = ["idea", "brief", "production", "review", "live"] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  idea: "Ideas",
  brief: "Briefed",
  production: "In production",
  review: "In review",
  live: "Live",
};

const NEXT_LABEL: Record<string, string> = {
  idea: "Brief it",
  brief: "Start production",
  production: "Send to review",
  review: "Approve & launch",
};

function CreativeInner() {
  const session = useSession();
  const persona = useActivePersona();
  const canAct = usePermission("marketing.view") && (session.role === "marketing_growth" || session.role === "hq_admin");
  const briefs = useAppStore((s) => s.creativeBriefs);
  const brands = useAppStore((s) => s.brands);
  const campaigns = useAppStore((s) => s.campaigns);
  const advanceCreative = useAppStore((s) => s.advanceCreative);
  const [launching, setLaunching] = useState<CreativeBrief | null>(null);

  const scoped = briefs.filter((b) => session.brandId === "all" || b.brandId === session.brandId);
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id;

  function advance(brief: CreativeBrief) {
    if (brief.stage === "review") {
      if (brief.claimsCheck === "pending") {
        toast.warning("Claims check pending", {
          description:
            "This asset mentions health territory — it launches only after the copy maps to an approved claim (Lipidri claims gate).",
        });
        return;
      }
      setLaunching(brief);
      return;
    }
    advanceCreative(brief.id, persona.name);
    toast.success(`${brief.id} → ${STAGES[STAGES.indexOf(brief.stage) + 1]}`);
  }

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Creative"
        description="The Creative Loop: demand from the media plan, briefs through production, launch bound to campaigns, performance feeding the next brief."
      />

      {/* demand vs supply */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">Required assets / week</div>
          <div className="tnum mt-0.5 text-lg font-semibold">{CREATIVE_DEMAND.requiredPerWeek}</div>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">In pipeline now</div>
          <div className={cn("tnum mt-0.5 text-lg font-semibold", CREATIVE_DEMAND.inPipeline < CREATIVE_DEMAND.requiredPerWeek && "text-warning")}>
            {scoped.filter((b) => b.stage !== "live").length}
          </div>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">Fatigue replacements</div>
          <div className="tnum mt-0.5 text-lg font-semibold">{scoped.filter((b) => b.fatigueReplacement).length}</div>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">Awaiting claims check</div>
          <div className={cn("tnum mt-0.5 text-lg font-semibold", scoped.some((b) => b.claimsCheck === "pending") && "text-warning")}>
            {scoped.filter((b) => b.claimsCheck === "pending").length}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">{CREATIVE_DEMAND.note}</p>

      {/* pipeline */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {STAGES.map((stage) => {
          const items = scoped.filter((b) => b.stage === stage);
          return (
            <Card key={stage} className="gap-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {STAGE_LABEL[stage]}
                </CardTitle>
                <Badge variant="outline" className="tnum text-[10px]">{items.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((b) => {
                  const campaign = campaigns.find((c) => c.id === b.campaignId);
                  return (
                    <div key={b.id} className={cn("rounded-md border p-2.5", b.fatigueReplacement && "border-warning/40")}>
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="text-xs font-medium leading-snug">{b.title}</span>
                        {b.fatigueReplacement && <Flame className="size-3.5 shrink-0 text-warning" aria-label="Fatigue replacement" />}
                      </div>
                      <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                        <div>{brandName(b.brandId)} · {b.format}</div>
                        <div className="italic">{b.angle}</div>
                        {campaign && (
                          <Link href={`/marketing?campaign=${campaign.id}`} className="block truncate text-info underline-offset-2 hover:underline">
                            {campaign.name}
                          </Link>
                        )}
                        <div className="tnum">due {formatRelative(b.dueAt)}</div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {b.claimsCheck !== "not_required" && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-0.5 text-[9px]",
                              b.claimsCheck === "passed" ? "border-success/30 text-success" : "border-warning/30 text-warning",
                            )}
                          >
                            <ShieldCheck className="size-2.5" aria-hidden />
                            claims {b.claimsCheck}
                          </Badge>
                        )}
                      </div>
                      {b.note && <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{b.note}</p>}
                      {stage !== "live" && canAct && (
                        <Button size="sm" variant="outline" className="mt-2 h-6 w-full gap-1 text-[10px]" onClick={() => advance(b)}>
                          {NEXT_LABEL[stage]} <ArrowRight className="size-2.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  );
                })}
                {items.length === 0 && <p className="py-3 text-center text-[11px] text-muted-foreground">Empty</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!canAct && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Advancing briefs needs the Marketing/Growth or HQ Admin role.
        </p>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Palette className="size-3.5" aria-hidden />
        Performance loops back: the fatigue flag on CRE-0009 comes from diagnosis DIA-0001 (AD-0003b CTR 1.8% → 0.9%) —
        see <Link href="/prophit" className="text-info underline-offset-2 hover:underline">Prophit</Link>.
      </p>

      {/* launch approval */}
      <ImpactPreviewDialog
        open={launching !== null}
        onOpenChange={(o) => !o && setLaunching(null)}
        title={`Approve & launch ${launching?.id}?`}
        description={`${launching?.title} — binds the asset to ${campaigns.find((c) => c.id === launching?.campaignId)?.name ?? "its campaign"} for lineage and performance tracking.`}
        impact={[
          { label: "Stage", value: "review → live", tone: "success" },
          { label: "Claims check", value: launching?.claimsCheck ?? "—", tone: launching?.claimsCheck === "passed" ? "success" : "neutral" },
          { label: "Campaign binding", value: launching?.campaignId ?? "unbound" },
        ]}
        externalDestination="None in Demo mode — in Live mode this uploads to the ad platform (write scope, separate approval)."
        reversibility="Reversible — pause the ad at platform level."
        auditNote="Recorded as creative.live with your persona; lineage keeps brief → asset → ad."
        confirmLabel="Approve & launch"
        onConfirm={() => {
          if (launching) {
            advanceCreative(launching.id, persona.name);
            toast.success(`${launching.id} is live`, { description: "Bound to its campaign for performance lineage." });
          }
        }}
      />
    </PageBody>
  );
}

export default function CreativePage() {
  return (
    <RouteGuard permission="marketing.view">
      <CreativeInner />
    </RouteGuard>
  );
}
