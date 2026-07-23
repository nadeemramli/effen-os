"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  commerce: "Commerce",
  ads: "Advertising",
  marketplace: "Marketplaces",
  payments: "Payments",
  logistics: "Couriers",
  cdp: "CDP",
  analytics: "Analytics",
  accounting: "Accounting",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "border-success/30 bg-success/10 text-success" },
  degraded: { label: "Degraded", className: "border-warning/30 bg-warning/10 text-warning" },
  stale: { label: "Stale", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  disconnected: { label: "Disconnected", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  pending_setup: { label: "Pending", className: "text-muted-foreground" },
};

function IntegrationsInner() {
  const integrations = useAppStore((s) => s.integrations);
  const brands = useAppStore((s) => s.brands);
  const personas = useAppStore((s) => s.personas);

  const groups = useMemo(() => {
    const map = new Map<string, typeof integrations>();
    for (const i of integrations) {
      const list = map.get(i.category) ?? [];
      list.push(i);
      map.set(i.category, list);
    }
    return [...map.entries()];
  }, [integrations]);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Integrations"
        description={`${integrations.length} connections · ${integrations.filter((i) => i.status === "healthy").length} healthy · ${integrations.filter((i) => i.status === "stale").length} stale`}
      />
      {groups.map(([category, list]) => (
        <section key={category} aria-label={CATEGORY_LABEL[category]}>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABEL[category] ?? category}
          </h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((i) => {
              const status = STATUS_META[i.status]!;
              return (
                <Link
                  key={i.id}
                  href={`/integrations/${i.id}`}
                  className={cn(
                    "rounded-lg border bg-card p-3.5 outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring",
                    i.status === "stale" && "border-destructive/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{i.name}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {i.environment} · {i.direction.replace("_", " + ")} ·{" "}
                        {i.brandScope.length === 0
                          ? "workspace-wide"
                          : i.brandScope.map((b) => brands.find((x) => x.id === b)?.name.replace(" (Demo)", "") ?? b).join(", ")}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 text-[10px]", status.className)}>{status.label}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">Last success</dt>
                      <dd><FreshnessBadge lastSuccessAt={i.lastSuccessAt} slaMinutes={i.freshnessSlaMinutes} /></dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Errors 24h</dt>
                      <dd className={cn("tnum", i.errorCount24h > 0 ? "text-warning" : "")}>{i.errorCount24h}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Owner</dt>
                      <dd>{personas.find((p) => p.id === i.ownerId)?.name ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Credential</dt>
                      <dd className={cn("tnum", i.credentialRotatesAt && new Date(i.credentialRotatesAt) < new Date("2026-08-06") ? "text-warning" : "text-muted-foreground")}>
                        {i.credentialRotatesAt ? `rotates ${formatRelative(i.credentialRotatesAt)}` : "n/a"}
                      </dd>
                    </div>
                  </dl>
                  {i.status !== "healthy" && i.notes && (
                    <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{i.notes}</p>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </PageBody>
  );
}

export default function IntegrationsPage() {
  return (
    <RouteGuard permission="integrations.view">
      <IntegrationsInner />
    </RouteGuard>
  );
}
