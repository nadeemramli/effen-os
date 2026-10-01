"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, ImageOff } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useSession } from "@/hooks/use-session";
import { FIXTURE_LEADERBOARD } from "@/lib/creative-lab/fixtures";
import { PROVISIONAL_RANKING_PARAMS, rankImages, type CohortRanking, type IneligibleReason } from "@/lib/creative-lab/ranking";
import type { ImageLeaderboardRow } from "@/lib/creative-lab/types";
import { useLabSource } from "@/lib/creative-lab/ui/source";
import { RouteGuard } from "@/lib/rbac/guard";
import { fetchImageLeaderboard } from "@/lib/supabase/creative-lab";
import { FixtureBanner, NotProvisioned, Pill, ProvisionalNote } from "../_components/lab-banners";
import { imageHref } from "../_components/links";

const REASON: Record<IneligibleReason, string> = {
  below_min_spend: "spend below provisional minimum",
  below_min_purchases: "too few purchases",
  immature_data: "late conversions still arriving",
  banned_account_excluded: "banned-account history excluded",
  unknown_currency: "currency unknown",
  unknown_cohort_field: "market/objective/attribution unknown — not comparable",
  zero_spend: "no spend",
};

const money = (n: number, ccy: string) => `${ccy} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ratio = (n: number | null) => (n == null ? "—" : n.toFixed(2));

function Thumb({ row }: { row: ImageLeaderboardRow }) {
  // bytes are only shown once archived by SHA-256; an expiring CDN URL is never used
  return (
    <div className="flex size-10 items-center justify-center rounded border bg-muted text-muted-foreground" title={`bytes: ${row.fetch_status ?? "not registered"}`}>
      <ImageOff className="size-4" aria-hidden />
    </div>
  );
}

function CohortTable({ c, source, brandId }: { c: CohortRanking; source: "live" | "fixture"; brandId: number | null }) {
  const ccy = c.cohort.currency_code;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {c.cohort.market} · {ccy} · {c.cohort.campaign_objective}
          <span className="ml-2 font-normal text-muted-foreground">
            attribution {c.cohort.attribution_setting} · {c.cohort.account_timezone}
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Cohort {money(c.pooledSpend, ccy)} spend · {c.pooledPurchases} purchases · ROAS {ratio(c.pooledRoas)}
        </span>
      </div>
      {c.ranked.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Image</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Purchases</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Shrunk ROAS</TableHead>
                <TableHead className="text-right">vs cohort</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Ads</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.ranked.map((x) => (
                <TableRow key={`${x.row.account_id}:${x.row.image_hash}`}>
                  <TableCell className="tnum">{x.rank}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Thumb row={x.row} />
                      <div className="text-xs">
                        <div className="font-mono">{x.row.image_hash.slice(0, 12)}</div>
                        <div className="text-muted-foreground">
                          {x.row.first_date} → {x.row.last_date}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="tnum text-right">{money(x.row.spend, ccy)}</TableCell>
                  <TableCell className="tnum text-right">{x.row.purchases ?? "—"}</TableCell>
                  <TableCell className="tnum text-right">{ratio(x.roas)}</TableCell>
                  <TableCell className="tnum text-right font-medium">{ratio(x.shrunkRoas)}</TableCell>
                  <TableCell className="tnum text-right">{x.indexVsCohort.toFixed(2)}×</TableCell>
                  <TableCell>
                    <Pill tone={x.tier === "leader" ? "good" : x.tier === "contender" ? "muted" : "warn"}>{x.tier.replace("_", " ")}</Pill>
                  </TableCell>
                  <TableCell className="tnum text-right">{x.row.distinct_ads}</TableCell>
                  <TableCell>
                    <Link href={imageHref(x.row, source, brandId)} className="inline-flex items-center text-xs text-primary hover:underline">
                      Evidence <ChevronRight className="size-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No image in this cohort meets the provisional screening thresholds.</p>
      )}
      {c.ineligible.length > 0 && (
        <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">{c.ineligible.length} not ranked — shown with reasons, never hidden</summary>
          <ul className="mt-2 space-y-1">
            {c.ineligible.map((x) => (
              <li key={`${x.row.account_id}:${x.row.image_hash}`} className="flex flex-wrap gap-x-3">
                <Link href={imageHref(x.row, source, brandId)} className="font-mono text-primary hover:underline">
                  {x.row.image_hash.slice(0, 12)}
                </Link>
                <span className="tnum">{money(x.row.spend, ccy)}</span>
                <span className="tnum">{x.row.purchases ?? 0} purchases</span>
                <span className="text-muted-foreground">{x.reasons.map((r) => REASON[r]).join("; ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Board({ rows, source, brandId }: { rows: ImageLeaderboardRow[]; source: "live" | "fixture"; brandId: number | null }) {
  const [market, setMarket] = useState<string>("all");
  const ranking = useMemo(() => rankImages(market === "all" ? rows : rows.filter((r) => r.market === market)), [rows, market]);
  const markets = [...new Set(rows.map((r) => r.market))].sort();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" variant="outline" size="sm" value={market} onValueChange={(v) => v && setMarket(v)}>
          <ToggleGroupItem value="all">All markets</ToggleGroupItem>
          {markets.map((m) => (
            <ToggleGroupItem key={m} value={m}>
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          Method {ranking.methodVersion} · {ranking.cohorts.length} comparable cohort{ranking.cohorts.length === 1 ? "" : "s"}
        </span>
      </div>
      {ranking.cohorts.length === 0 ? (
        <EmptyState title="No single-image results in this window" description="Only single-image ads with an exact image are ranked here; carousel, dynamic and video totals are never credited to one image." />
      ) : (
        ranking.cohorts.map((c) => <CohortTable key={c.cohortId} c={c} source={source} brandId={brandId} />)
      )}
    </div>
  );
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function LiveBoard() {
  const session = useSession();
  const brandId = session.liveBrandId;
  const from = isoDaysAgo(90);
  const to = isoDaysAgo(0);
  const q = useLiveQuery(
    () => (brandId == null ? Promise.resolve(null) : fetchImageLeaderboard(brandId, null, from, to)),
    [brandId, from, to],
  );
  if (brandId == null) return <EmptyState title="Choose a brand" description="Pick one brand in the top bar — posters are only ranked within a brand." />;
  if (q.error) return q.error.includes("not available") ? <NotProvisioned /> : <ErrorState title="Leaderboard failed to load" description={q.error} retry={() => void q.reload()} />;
  if (q.loading || !q.data) return <SkeletonTable rows={8} />;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Window {from} → {to} · facts synced {q.data.as_of ? new Date(q.data.as_of).toLocaleString() : "never"}
      </p>
      <Board rows={q.data.rows} source="live" brandId={brandId} />
    </>
  );
}

function LeaderboardInner() {
  const source = useLabSource();
  const p = PROVISIONAL_RANKING_PARAMS;
  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Poster lab — image leaderboard"
        description="Owned single-image ads, ranked within comparable cohorts (market, currency, objective, attribution, timezone). A screening of which posters to study — not proof that a poster caused its results."
      />
      <ProvisionalNote>
        Provisional screening configuration, not significance tests: minimum spend {p.minSpend} (cohort currency), minimum {p.minPurchases} purchases,
        at most {Math.round(p.maxMaturingShare * 100)}% of spend still in the late-conversion window, {p.priorSpend} pseudo-spend shrinkage toward the cohort,
        &ldquo;leader&rdquo; at ≥{Math.round(p.leaderUplift * 100)}% over the cohort. Platform-attributed purchases only.
      </ProvisionalNote>
      {source === "fixture" ? (
        <>
          <FixtureBanner what="Nine synthetic Adipocyde-shaped images across two cohorts, including a lucky small sample, immature data and an unknown attribution setting." />
          <Board rows={FIXTURE_LEADERBOARD} source="fixture" brandId={null} />
        </>
      ) : (
        <LiveBoard />
      )}
    </PageBody>
  );
}

export default function LeaderboardPage() {
  return (
    <RouteGuard permission="marketing.view">
      <LeaderboardInner />
    </RouteGuard>
  );
}
