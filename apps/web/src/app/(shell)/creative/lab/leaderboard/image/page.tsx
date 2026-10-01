"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { ErrorState, SkeletonCards } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { buildFixtureContext, FIXTURE_LEADERBOARD } from "@/lib/creative-lab/fixtures";
import { rankImages } from "@/lib/creative-lab/ranking";
import { renderSop } from "@/lib/creative-lab/sop";
import { RouteGuard } from "@/lib/rbac/guard";
import { fetchImageEvidence, type ImageEvidence } from "@/lib/supabase/creative-lab";
import { FixtureBanner, NotProvisioned, Pill } from "../../_components/lab-banners";

interface Step {
  label: string;
  identity: string;
  state: "good" | "warn" | "bad" | "muted";
  status: string;
  note?: string;
}

/** The identity chain: ad execution → creative config → platform image → exact bytes → analysis → recipe. */
function Lineage({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative space-y-3 border-l pl-5">
      {steps.map((s) => (
        <li key={s.label} className="relative">
          <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border bg-background" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{s.label}</span>
            <Pill tone={s.state}>{s.status}</Pill>
          </div>
          <div className="font-mono text-xs text-muted-foreground">{s.identity}</div>
          {s.note && <p className="mt-0.5 text-xs text-muted-foreground">{s.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 text-base font-semibold">{value}</div>
    </div>
  );
}

function FixtureEvidence({ account, hash }: { account: string; hash: string }) {
  const row = FIXTURE_LEADERBOARD.find((r) => r.account_id === account && r.image_hash === hash);
  const [sop, setSop] = useState<string | null>(null);
  const ranking = rankImages(FIXTURE_LEADERBOARD);
  const cohort = ranking.cohorts.find((c) => [...c.ranked, ...c.ineligible].some((x) => x.row === row));
  const ranked = cohort?.ranked.find((x) => x.row === row);
  const isTop = !!ranked && ranked.rank === 1;

  useEffect(() => {
    if (!isTop || !row || !cohort || !ranked) return;
    let live = true;
    void buildFixtureContext().then((fx) => {
      if (!live) return;
      setSop(
        renderSop(fx.recipe, fx.analysis, {
          brand: "Adipocyde (fixture)",
          market: row.market,
          cohort: cohort.cohortId,
          window: `${row.first_date}..${row.last_date}`,
          method_version: ranking.methodVersion,
          rank: ranked.rank,
          spend: row.spend,
          currency: row.currency_code,
          purchases: row.purchases ?? 0,
          roas: ranked.roas,
          shrunk_roas: ranked.shrunkRoas,
          maturing_share: row.maturing_spend / row.spend,
          snapshot_id: null,
          fixture: true,
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [isTop, row, cohort, ranked, ranking.methodVersion]);

  if (!row || !cohort) return <ErrorState title="Unknown fixture image" description={`${account}:${hash}`} />;
  const ccy = row.currency_code;
  return (
    <>
      <FixtureBanner what="This evidence chain is synthetic. The SOP is a template render from a fixture analysis." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Cohort" value={`${row.market} · ${ccy}`} />
        <Stat label="Rank" value={ranked ? `#${ranked.rank} of ${cohort.ranked.length}` : "not ranked"} />
        <Stat label="Spend" value={`${ccy} ${row.spend.toLocaleString()}`} />
        <Stat label="Purchases (platform)" value={String(row.purchases ?? "—")} />
        <Stat label="ROAS raw / shrunk" value={ranked ? `${ranked.roas.toFixed(2)} / ${ranked.shrunkRoas.toFixed(2)}` : "—"} />
      </div>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Identity and lineage</h2>
          <Lineage
            steps={[
              { label: "Ad executions", identity: `${row.distinct_ads} single-image ads, ≤${row.max_concurrent_ads} concurrent`, state: "good", status: "bound", note: "Each ad points to exactly one creative; carousel/dynamic/video ads never reach this page." },
              { label: "Creative configuration", identity: "creative_id per ad (fixture)", state: "good", status: "single_image" },
              { label: "Platform image", identity: `${row.account_id} : ${row.image_hash}`, state: "good", status: "meta image_hash" },
              { label: "Exact bytes", identity: row.asset_sha256 ?? "sha256 unknown", state: "warn", status: row.fetch_status ?? "not registered", note: "Fetched once from Meta's expiring URL, hashed, archived immutably in GCS. Blocked until the media bucket exists." },
              { label: "Poster analysis", identity: isTop ? "poster-analysis-v1 (fixture)" : "none", state: isTop ? "warn" : "muted", status: isTop ? "draft · needs review" : "not analysed" },
              { label: "Recipe + SOP", identity: isTop ? "adipocyde-fixture-hero-right v1" : "none", state: isTop ? "warn" : "muted", status: isTop ? "draft · needs review" : "—" },
            ]}
          />
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Reconstruction SOP</h2>
          {sop ? (
            <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">{sop}</pre>
          ) : (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              {isTop ? "Rendering…" : "Only the cohort leader has a (fixture) analysis and SOP in this walkthrough."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function LiveEvidence({ brandId, account, hash }: { brandId: number; account: string; hash: string }) {
  const q = useLiveQuery<ImageEvidence>(() => fetchImageEvidence(brandId, account, hash), [brandId, account, hash]);
  if (q.error) return q.error.includes("not available") ? <NotProvisioned /> : <ErrorState title="Evidence failed to load" description={q.error} retry={() => void q.reload()} />;
  if (q.loading || !q.data) return <SkeletonCards count={4} />;
  const e = q.data;
  const spend = e.ads.reduce((a, x) => a + Number(x.spend ?? 0), 0);
  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Identity and lineage</h2>
        <Lineage
          steps={[
            { label: "Ad executions", identity: `${e.ads.length} ads`, state: e.ads.length ? "good" : "muted", status: e.ads.length ? "bound" : "none synced" },
            { label: "Platform image", identity: `${account} : ${hash}`, state: "good", status: "meta image_hash" },
            { label: "Exact bytes", identity: e.asset?.sha256 ?? "sha256 unknown", state: e.asset ? "good" : "warn", status: e.platform_ref?.fetch_status ?? "not registered" },
            { label: "Same bytes elsewhere", identity: e.same_bytes_refs.map((r) => `${r.account_id}:${r.image_hash.slice(0, 8)}`).join(", ") || "none", state: "muted", status: `${e.same_bytes_refs.length} refs` },
            { label: "Poster analyses", identity: `${e.analyses.length}`, state: e.analyses.length ? "warn" : "muted", status: e.analyses.length ? "see review state" : "not analysed" },
          ]}
        />
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Ads using this image</h2>
        <ul className="divide-y rounded-lg border bg-card text-xs">
          {e.ads.map((a) => (
            <li key={a.ad_id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span className="font-mono">{a.ad_id}</span>
              <span className="text-muted-foreground">
                {a.first_date} → {a.last_date}
              </span>
              <span className="tnum">spend {Number(a.spend).toLocaleString()} · {a.purchases ?? "—"} purchases</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Total ad-grain spend {spend.toLocaleString()} (currency per cohort; never summed across currencies elsewhere).</p>
      </div>
    </section>
  );
}

function ImageEvidenceInner() {
  const sp = useSearchParams();
  const account = sp.get("account") ?? "";
  const hash = sp.get("hash") ?? "";
  const source = sp.get("source") === "live" ? "live" : "fixture";
  const brand = Number(sp.get("brand"));
  return (
    <PageBody className="max-w-none">
      <Link href="/creative/lab/leaderboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Image leaderboard
      </Link>
      <PageHeader
        title={`Image ${hash.slice(0, 12)}`}
        description="Observational evidence for one exact image, and everything Fullkit has derived from it. Performance is a reason to study a poster, not proof its structure caused the result."
      />
      {source === "fixture" ? (
        <FixtureEvidence account={account} hash={hash} />
      ) : Number.isFinite(brand) && brand > 0 ? (
        <LiveEvidence brandId={brand} account={account} hash={hash} />
      ) : (
        <ErrorState title="Missing brand" description="Open this page from the leaderboard." />
      )}
    </PageBody>
  );
}

export default function ImageEvidencePage() {
  return (
    <RouteGuard permission="marketing.view">
      <Suspense fallback={<SkeletonCards count={4} />}>
        <ImageEvidenceInner />
      </Suspense>
    </RouteGuard>
  );
}
