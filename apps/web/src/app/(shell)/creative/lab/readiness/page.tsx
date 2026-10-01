"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { ErrorState, SkeletonTable } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLiveQuery } from "@/hooks/use-live-query";
import { MISSING_CONFIG_LABELS, readinessOf, type ReadinessStage } from "@/lib/creative-lab/readiness";
import type { BrandReadinessRow, MissingConfigKey } from "@/lib/creative-lab/types";
import { HANDOVER_INVENTORY, useLabSource } from "@/lib/creative-lab/ui/source";
import { RouteGuard } from "@/lib/rbac/guard";
import { CreativeNotProvisionedError, fetchCreativeReadiness } from "@/lib/supabase/creative-lab";
import { FixtureBanner, NotProvisioned, Pill } from "../_components/lab-banners";

const ALL_MISSING = Object.keys(MISSING_CONFIG_LABELS) as MissingConfigKey[];

/** Fixture readiness: the handover inventory, honestly un-imported. */
const FIXTURE_ROWS: BrandReadinessRow[] = HANDOVER_INVENTORY.map((b, i) => ({
  brand_id: i + 1,
  brand_slug: b.slug,
  brand_name: b.name,
  kit_version_id: null,
  kit_version: null,
  kit_status: "none",
  kit_provenance: null,
  kit_completeness: null,
  packshots: 0,
  kit_assets: 0,
  image_fact_rows: 0,
  facts_synced_at: null,
  missing_config: ALL_MISSING,
  batches: 0,
}));

const STAGE: Record<ReadinessStage, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  no_kit: { label: "Kit not imported", tone: "muted" },
  kit_draft: { label: "Kit awaiting approval", tone: "warn" },
  no_packshots: { label: "No packshots", tone: "bad" },
  needs_config: { label: "Owner decisions missing", tone: "warn" },
  ready: { label: "Ready to generate", tone: "good" },
};

function ReadinessTable({ rows, fixture }: { rows: BrandReadinessRow[]; fixture: boolean }) {
  const reported = new Map(HANDOVER_INVENTORY.map((b) => [b.slug, b]));
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Brand kit</TableHead>
            <TableHead className="text-right">Packshots</TableHead>
            <TableHead>Ad performance</TableHead>
            <TableHead>What blocks production</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const v = readinessOf(r);
            const rep = reported.get(r.brand_slug);
            return (
              <TableRow key={r.brand_id} className="align-top">
                <TableCell>
                  <div className="font-medium">{r.brand_name}</div>
                  {rep?.note && <div className="text-[11px] text-muted-foreground">{rep.note}</div>}
                </TableCell>
                <TableCell>
                  <Pill tone={STAGE[v.stage].tone}>{STAGE[v.stage].label}</Pill>
                </TableCell>
                <TableCell className="text-xs">
                  {r.kit_status === "none" ? (
                    <span className="text-muted-foreground">Not imported</span>
                  ) : (
                    <span>
                      v{r.kit_version} · {r.kit_status} · {r.kit_provenance?.replace("_", " ")} · {r.kit_completeness}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tnum text-right text-xs">
                  {r.packshots}
                  {fixture && rep && (
                    <div className="text-[11px] text-muted-foreground">{rep.packshotsReported} reported, unverified</div>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {v.hasPerformanceData ? (
                    <span>{r.image_fact_rows.toLocaleString()} image-days</span>
                  ) : (
                    <span className="text-muted-foreground">No image facts synced</span>
                  )}
                </TableCell>
                <TableCell>
                  <ul className="space-y-0.5 text-xs">
                    {v.blockers.slice(0, 4).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                    {v.blockers.length > 4 && <li className="text-muted-foreground">+{v.blockers.length - 4} more</li>}
                  </ul>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function OwnerDecisions() {
  const groups = (["generation", "analysis", "launch"] as const).map((g) => ({
    g,
    keys: ALL_MISSING.filter((k) => MISSING_CONFIG_LABELS[k].blocks === g),
  }));
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {groups.map(({ g, keys }) => (
        <div key={g} className="rounded-lg border bg-card p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Blocks {g}</div>
          <ul className="mt-1.5 space-y-1 text-sm">
            {keys.map((k) => (
              <li key={k}>{MISSING_CONFIG_LABELS[k].label}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LiveReadiness() {
  const q = useLiveQuery(fetchCreativeReadiness, []);
  if (q.error) {
    return q.error.includes("not available") ? <NotProvisioned /> : <ErrorState title="Readiness failed to load" description={q.error} retry={() => void q.reload()} />;
  }
  if (q.loading || !q.data) return <SkeletonTable rows={6} />;
  return <ReadinessTable rows={q.data} fixture={false} />;
}

function LabReadinessInner() {
  const source = useLabSource();
  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Poster lab — brand readiness"
        description="What each brand needs before Fullkit can study its posters and generate candidates: an approved brand kit, authentic packshots, synced single-image performance, and the owner decisions the system must not invent."
      >
        <Link href="/creative/lab/leaderboard" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          Image leaderboard <ArrowRight className="size-3.5" />
        </Link>
      </PageHeader>
      {source === "fixture" ? (
        <>
          <FixtureBanner what="Brands and packshot counts below are as reported by the handover; no kit has been imported in this environment." />
          <ReadinessTable rows={FIXTURE_ROWS} fixture />
        </>
      ) : (
        <LiveReadiness />
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Owner decisions — required before paid execution or launch</h2>
        <p className="text-xs text-muted-foreground">
          Set per brand by an HQ admin (versioned and audited). Missing values never block read-only analysis or fixture runs;
          they do block generation or launch as marked. Drafts are never promoted silently.
        </p>
        <OwnerDecisions />
      </section>
    </PageBody>
  );
}

export default function LabReadinessPage() {
  return (
    <RouteGuard permission="marketing.view">
      <LabReadinessInner />
    </RouteGuard>
  );
}
