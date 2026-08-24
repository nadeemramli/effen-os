"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Plus, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/tables/data-table";
import { ErrorState, InlineCount, RefreshChip } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { LifecycleCell, type LifecycleLookup } from "@/components/customers/lifecycle-cell";
import { FollowUpDialog, OpenWorkItem, type FollowUpTarget } from "@/components/customers/follow-up-dialog";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import { COHORTS, type CohortKey, type CohortSummary, type WorkItem, type WorkItemAction } from "@/lib/domain/cohorts";
import {
  fetchCustomerLifecycleStates,
  fetchCustomerSegmentSummary,
  fetchCustomerWorkItems,
  fetchLiveCustomers,
  type LiveCustomerRow,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";
import { maskPhone } from "@/lib/utils/mask";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
/** Nightly refresh → anything older than 26 h is stale. */
const FRESHNESS_SLA_MINUTES = 26 * 60;

const DEFAULT_ACTION: Record<CohortKey, WorkItemAction> = {
  vip: "review",
  at_risk: "call",
  shared_address: "address_review",
};

function money(byCcy: Record<string, number>): string {
  const parts = Object.entries(byCcy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => `${c === "MYR" ? "RM" : c === "SGD" ? "S$" : c} ${v >= 10_000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`);
  return parts.join(" + ") || "—";
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

interface MembersPage {
  rows: LiveCustomerRow[];
  total: number;
  lifecycle: LifecycleLookup;
  workItems: WorkItem[];
}

/** One cohort page: served header numbers, the member list, and audited follow-ups. */
export function CohortWorkspace({ cohort }: { cohort: CohortKey }) {
  return (
    <LiveGuard>
      <RouteGuard permission="customers.view">
        <CohortInner cohort={cohort} />
      </RouteGuard>
    </LiveGuard>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 text-base font-semibold">{value}</div>
    </div>
  );
}

function CohortInner({ cohort }: { cohort: CohortKey }) {
  const def = COHORTS[cohort];
  const router = useRouter();
  const canFollowUp = usePermission("customers.followup");
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [draft, setDraft] = useState(q);
  const [target, setTarget] = useState<FollowUpTarget | null>(null);

  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const marketsKey = liveMarkets.join(",");

  const summary = useLiveQuery<CohortSummary>(
    () => fetchCustomerSegmentSummary({ cohort, brandId: liveBrandId, countries: liveMarkets }),
    [cohort, liveBrandId, marketsKey],
  );

  const members = useLiveQuery<MembersPage>(async () => {
    const res = await fetchLiveCustomers({
      page,
      pageSize: PAGE_SIZE,
      search: q,
      brandId: liveBrandId,
      countries: liveMarkets,
      conditions: def.conditions,
    });
    const keys = res.rows.map((r) => r.identity_key);
    // Lifecycle and follow-ups are per page; either failing must not hide the rows.
    const [lifecycle, workItems] = await Promise.all([
      fetchCustomerLifecycleStates(keys).catch((): LifecycleLookup => ({ status: "error" })),
      fetchCustomerWorkItems(keys).catch((): WorkItem[] => []),
    ]);
    return { rows: res.rows, total: res.total, lifecycle, workItems };
  }, [cohort, page, q, liveBrandId, marketsKey]);

  const openByKey = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const w of members.data?.workItems ?? []) {
      if (w.status !== "open") continue;
      const key = w.entity_ref.replace(/^customer:/, "");
      m.set(key, [...(m.get(key) ?? []), w]);
    }
    return m;
  }, [members.data?.workItems]);

  const ok = summary.data?.status === "ok" ? summary.data : null;
  const total = members.data?.total ?? null;
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));

  const columns = useMemo<ColumnDef<LiveCustomerRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Customer",
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.display_name ?? "Unknown"}</div>
            <div className="tnum text-[11px] text-muted-foreground">
              {row.original.phone ? maskPhone(row.original.phone, false) : row.original.email ?? "—"}
            </div>
          </div>
        ),
      },
      {
        id: "lifecycle",
        header: "Lifecycle",
        enableSorting: false,
        cell: ({ row }) => <LifecycleCell lookup={members.data?.lifecycle ?? null} identityKey={row.original.identity_key} />,
      },
      {
        id: "orders",
        header: "Orders",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum">{row.original.total_orders}</span>,
      },
      {
        id: "revenue",
        header: "Recognized revenue",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum">{money(row.original.revenue_by_currency ?? {})}</span>,
      },
      {
        id: "last",
        header: "Last order",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum text-muted-foreground">{relative(row.original.last_order_at)}</span>,
      },
      ...(cohort === "shared_address"
        ? [
            {
              id: "cluster",
              header: "At address",
              enableSorting: false,
              cell: ({ row }) => (
                <span className="tnum" title="Resolved identities sharing this normalized address">
                  ×{row.original.shared_address_count ?? 1}
                  {Number(row.original.distinct_names) > 1 && <span className="text-muted-foreground"> · {row.original.distinct_names} names</span>}
                </span>
              ),
            } satisfies ColumnDef<LiveCustomerRow, unknown>,
          ]
        : [
            {
              id: "class",
              header: "Class",
              enableSorting: false,
              cell: ({ row }) => <span className="text-xs capitalize">{(row.original.classification ?? "—").replace("_", " ")}</span>,
            } satisfies ColumnDef<LiveCustomerRow, unknown>,
          ]),
      {
        id: "followup",
        header: "Follow-up",
        enableSorting: false,
        cell: ({ row }) => {
          const open = openByKey.get(row.original.identity_key) ?? [];
          return (
            <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
              {open.map((w) => (
                <OpenWorkItem key={w.id} item={w} canClose={canFollowUp} compact onClosed={() => void members.reload()} />
              ))}
              {canFollowUp && open.length === 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-fit gap-1 px-1.5 text-[11px]"
                  onClick={() => setTarget({ identityKey: row.original.identity_key, displayName: row.original.display_name })}
                >
                  <Plus className="size-3" aria-hidden /> Log
                </Button>
              )}
              {!canFollowUp && open.length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
            </div>
          );
        },
      },
    ],
    [cohort, canFollowUp, members, openByKey],
  );

  return (
    <PageBody>
      <PageHeader title={def.label} description={def.intent}>
        <Button asChild variant="outline" size="sm">
          <Link href={`/customers?segment=${def.starter}`}>Open in All customers</Link>
        </Button>
      </PageHeader>

      {/* rule + trust strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{ok?.definition.rule ?? summary.data?.definition.rule ?? def.rule}</span>
        {summary.data && (
          <Badge variant="outline" className="h-5 font-normal">
            {summary.data.definition.rule_version}
            {!summary.data.definition.governed && " · unversioned"}
          </Badge>
        )}
        {ok && (
          <span className="inline-flex items-center gap-1">
            Computed <FreshnessBadge lastSuccessAt={ok.computed_at} slaMinutes={FRESHNESS_SLA_MINUTES} realClock />
          </span>
        )}
        {summary.refreshing && <RefreshChip />}
      </div>

      {summary.error ? (
        <ErrorState title="Could not load the cohort summary" description={summary.error} retry={() => void summary.reload()} />
      ) : summary.data?.status === "unavailable" ? (
        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Cohort numbers unavailable: {summary.data.reason === "no_policy" ? "no lifecycle policy is set" : "the lifecycle contract has not been computed yet"}. The member list below still reflects the rule.
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Tile label="Members" value={<InlineCount value={ok?.stats.members ?? null} width="w-12" />} />
          {cohort === "shared_address" ? (
            <Tile label="Address clusters" value={<InlineCount value={ok?.stats.address_clusters ?? null} width="w-12" />} hint="Distinct normalized addresses behind the members" />
          ) : (
            <Tile
              label={cohort === "at_risk" ? "Days to lapse" : "Of which at risk"}
              value={
                cohort === "at_risk"
                  ? ok ? `${ok.policy.at_risk_days}–${ok.policy.threshold_days}` : "—"
                  : <InlineCount value={ok?.stats.lifecycle.at_risk ?? null} width="w-10" />
              }
              hint={cohort === "at_risk" ? "Window since the last qualifying purchase under the current policy" : "Governed lifecycle state at_risk"}
            />
          )}
          <Tile label="Ordered in 30 d" value={<InlineCount value={ok?.stats.ordered_30d ?? null} width="w-10" />} />
          <Tile label="Recognized revenue" value={ok ? money(ok.stats.revenue_by_currency) : "—"} hint="Lifetime, by currency; no FX applied" />
          <Tile label="COD share" value={ok ? (ok.stats.cod_share === null ? "n/a" : `${ok.stats.cod_share}%`) : "—"} />
          <Tile label="Open follow-ups" value={<InlineCount value={ok?.stats.open_work_items ?? null} width="w-8" />} />
        </section>
      )}

      {/* consent + outbound — stated, never faked */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <ShieldOff className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">Consent &amp; suppression: not connected.</span>
        <span className="text-muted-foreground">
          No consent, opt-out or frequency source feeds Fullkit yet, so no message can be sent from here. Follow-ups are internal work items; a person makes the call or sends the message.
          {cohort === "shared_address" && " Shared addresses are a review signal only — never merged and never targeted as a group."}
        </span>
      </div>

      {/* members */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void setQ(draft.trim() || null);
            void setPage(null);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Name, phone, e-mail…"
            className="h-8 w-64 text-xs"
            aria-label="Search members"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8">Search</Button>
        </form>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tnum"><InlineCount value={total} width="w-10" /> members</span>
          <Button size="icon" variant="ghost" className="size-7" disabled={page <= 1} onClick={() => void setPage(page - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tnum">{page} / {pageCount}</span>
          <Button size="icon" variant="ghost" className="size-7" disabled={page >= pageCount} onClick={() => void setPage(page + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
          {members.refreshing && <RefreshChip />}
        </div>
      </div>

      {members.error ? (
        <ErrorState title="Could not load members" description={members.error} retry={() => void members.reload()} />
      ) : (
        <div className={cn(members.refreshing && "opacity-70")}>
          <DataTable
            columns={columns}
            data={members.data?.rows ?? []}
            loading={members.loading}
            pageSize={PAGE_SIZE}
            rowKey={(r) => r.identity_key}
            onRowClick={(r) => router.push(`/customers/${encodeURIComponent(r.identity_key)}`)}
            emptyTitle="Nobody in this cohort"
            emptyDescription="No customers match the rule for the selected brand and markets."
          />
        </div>
      )}

      <FollowUpDialog
        target={target}
        source={cohort}
        defaultAction={DEFAULT_ACTION[cohort]}
        onClose={() => setTarget(null)}
        onCreated={() => void members.reload()}
      />
    </PageBody>
  );
}
