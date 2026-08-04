"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { fetchAutomationHealth, type AutomationHealth } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

/**
 * The automation registry: every rule that runs without a human — whether it
 * lives in code (crons, webhooks, SQL gates) or was configured in-app — one
 * row each, grouped by the department that owns the outcome. Health lines are
 * live. Nothing here is invisible: each entry names its trigger, its
 * guardrail, and where it is defined.
 */

type Dept =
  | "Logistics & Fulfilment"
  | "Data & Integrations"
  | "Merchandise & Catalog"
  | "Marketing & Analytics"
  | "Customers & CX"
  | "Finance";

const DEPT_ORDER: Dept[] = [
  "Logistics & Fulfilment",
  "Data & Integrations",
  "Merchandise & Catalog",
  "Marketing & Analytics",
  "Customers & CX",
  "Finance",
];

type Guardrail = "runs itself" | "suggest-only" | "human-confirm" | "read-only";
type Status = "live" | "on hold" | "planned";

interface AutomationEntry {
  key: string;
  dept: Dept;
  name: string;
  what: string;
  trigger: string;
  guardrail: Guardrail;
  source: string;
  status: Status;
  link?: { href: string; label: string };
  /** Renders the live health line from the health blob. */
  health?: (h: AutomationHealth) => string | null;
}

function rel(iso: unknown): string {
  if (typeof iso !== "string") return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

const REGISTRY: AutomationEntry[] = [
  // ── Logistics & Fulfilment ────────────────────────────────────────────────
  {
    key: "ship_gate",
    dept: "Logistics & Fulfilment",
    name: "Ship-readiness gate",
    what: "Grades every pre-ship order with market-aware address rules (name, phone format, postcode, address substance). Three lanes: green auto-pass, yellow suggestions shown but never applied, red human-fix queue.",
    trigger: "on view",
    guardrail: "suggest-only",
    source: "supabase · live_ship_readiness()",
    status: "live",
    link: { href: "/fulfilment", label: "Fulfilment floor" },
    health: (h) =>
      `${n(h.ship_gate?.checked_14d).toLocaleString()} checked · ${n(h.ship_gate?.flagged_14d).toLocaleString()} flagged · ${n(h.ship_gate?.corrected_14d).toLocaleString()} corrected (14d)`,
  },
  {
    key: "correction_regrade",
    dept: "Logistics & Fulfilment",
    name: "Correction re-grade",
    what: "A shipping fix saved in the OS re-grades the gate immediately — original values retained, every change audited. Stays internal until write-back to Woo is approved.",
    trigger: "on save",
    guardrail: "human-confirm",
    source: "supabase · save_order_correction()",
    status: "live",
    health: (h) => `${n(h.corrections?.staged)} staged correction${n(h.corrections?.staged) === 1 ? "" : "s"}`,
  },
  {
    key: "nv_tracking",
    dept: "Logistics & Fulfilment",
    name: "Ninja Van tracking ingestion",
    what: "HMAC-verified webhook streams every parcel milestone from the NV shipper account into the delivery network view.",
    trigger: "webhook",
    guardrail: "runs itself",
    source: "edge function · nv-webhook",
    status: "live",
    link: { href: "/fulfilment", label: "Network view" },
    health: (h) =>
      `${n(h.nv?.events_24h).toLocaleString()} events 24h · ${n(h.nv?.parcels).toLocaleString()} parcels · last ${rel(h.nv?.last_event_at)}`,
  },
  {
    key: "woo_writeback",
    dept: "Logistics & Fulfilment",
    name: "Correction write-back to Woo",
    what: "Push staged corrections to the source order so labels print the fixed address. Needs one write-scoped Woo REST key (pilot store) — ADR-0002 Phase 1a.",
    trigger: "on approval",
    guardrail: "human-confirm",
    source: "planned",
    status: "planned",
  },
  {
    key: "nv_consignment",
    dept: "Logistics & Fulfilment",
    name: "NV consignment creation",
    what: "Fullkit creates courier orders for green-lane orders. On hold pending the multi-stakeholder decision (Fighter scope-down, COD continuity) — ADR-0002.",
    trigger: "on approval",
    guardrail: "human-confirm",
    source: "on hold · ADR-0002",
    status: "on hold",
  },
  // ── Data & Integrations ───────────────────────────────────────────────────
  {
    key: "woo_orders",
    dept: "Data & Integrations",
    name: "WooCommerce order sync",
    what: "Mirrors orders from all 8 storefronts into the read-side, checkpointed on source modification time. Reason-coded run log; checkpoint only advances on success.",
    trigger: "cron · 15 min",
    guardrail: "runs itself",
    source: "edge function · woo-sync",
    status: "live",
    link: { href: "/setup", label: "Connections" },
    health: (h) =>
      `last ${rel(h.woo_orders?.last_success_at)} · ${n(h.woo_orders?.runs_24h).toLocaleString()} runs 24h · ${n(h.woo_orders?.failed_24h)} failed`,
  },
  {
    key: "woo_products",
    dept: "Data & Integrations",
    name: "WooCommerce product mirror",
    what: "Mirrors each store's published catalog (the marketer-owned channel plane) read-only. Full refresh; deletions tracked; marketers keep sole ownership of WordPress.",
    trigger: "cron · hourly",
    guardrail: "runs itself",
    source: "edge function · woo-products-sync",
    status: "live",
    link: { href: "/catalog", label: "Catalog" },
    health: (h) => `${n(h.woo_products?.mirrored)} products mirrored · last ${rel(h.woo_products?.last_success_at)}`,
  },
  {
    key: "customers_mv",
    dept: "Data & Integrations",
    name: "Customer read-model refresh",
    what: "Rebuilds the customer 360 identity model from the order mirror (concurrent refresh, no read downtime).",
    trigger: "cron · 15 min",
    guardrail: "runs itself",
    source: "pg_cron · customers-read-refresh",
    status: "live",
    health: (h) => `last refresh ${rel(h.customers_mv?.last_refresh_at)}`,
  },
  {
    key: "ads_ingest",
    dept: "Data & Integrations",
    name: "Ads ingestion (Airbyte → BigQuery)",
    what: "Meta/TikTok spend into the warehouse, GCS as landing zone including banned-account CSV exports — ADR-0003. Stands up with the Airbyte pipeline.",
    trigger: "cron · daily",
    guardrail: "runs itself",
    source: "planned · ADR-0003",
    status: "planned",
  },
  // ── Merchandise & Catalog ─────────────────────────────────────────────────
  {
    key: "sku_detect",
    dept: "Merchandise & Catalog",
    name: "New store SKU detection",
    what: "Published catalogs ∪ order lines feed the mapping queue, so a new Woo product surfaces before its first sale. The mapping itself is always a human click — never guessed.",
    trigger: "on sync",
    guardrail: "human-confirm",
    source: "supabase · live_sku_mapping_queue()",
    status: "live",
    link: { href: "/catalog", label: "Mapping queue" },
    health: (h) => `${n(h.mapping?.aliases)} mapped · ${n(h.mapping?.unmapped_published)} awaiting confirmation`,
  },
  {
    key: "price_drift",
    dept: "Merchandise & Catalog",
    name: "Price-drift watch",
    what: "Compares each store's live published price against the canonical expectation on every mirror pass; drift becomes a counted badge, not a surprise in margin math.",
    trigger: "on sync",
    guardrail: "read-only",
    source: "supabase · live_merchandise()",
    status: "live",
    link: { href: "/catalog", label: "Catalog" },
    health: (h) => `${n(h.drift?.variants)} variant${n(h.drift?.variants) === 1 ? "" : "s"} drifting`,
  },
  {
    key: "cogs_effective",
    dept: "Merchandise & Catalog",
    name: "Effective-dated COGS resolution",
    what: "Margin on an order uses the cost that was true when the order was placed; costs pair with revenue in the same currency only (FX policy pending).",
    trigger: "on view",
    guardrail: "runs itself",
    source: "supabase · live_unit_economics()",
    status: "live",
    health: (h) => `${n(h.costs?.costed_variants)}/${n(h.costs?.total_variants)} variants costed`,
  },
  // ── Marketing & Analytics ─────────────────────────────────────────────────
  {
    key: "market_dim",
    dept: "Marketing & Analytics",
    name: "Market derivation",
    what: "Every order, connection, and ad account resolves to MY/SG from its store domain — powers the top-bar market checklist on all live surfaces.",
    trigger: "on sync",
    guardrail: "runs itself",
    source: "supabase · connections config",
    status: "live",
  },
  {
    key: "baseline",
    dept: "Marketing & Analytics",
    name: "Plan-vs-actual baseline",
    what: "Expectation per brand/market/currency from a 4-week same-weekday average — statistical, not a target. Feeds the Command Centre variance card.",
    trigger: "on view",
    guardrail: "read-only",
    source: "supabase · live_plan_baseline()",
    status: "live",
    link: { href: "/command-center", label: "Command Centre" },
  },
  // ── Customers & CX ────────────────────────────────────────────────────────
  {
    key: "identity",
    dept: "Customers & CX",
    name: "Identity resolution",
    what: "Merges orders into one customer by normalized phone (email fallback) — the spine of the 360, lifecycle, and LTV.",
    trigger: "on refresh",
    guardrail: "runs itself",
    source: "supabase · customers_read model",
    status: "live",
    link: { href: "/customers", label: "Customers" },
  },
  {
    key: "lifecycle",
    dept: "Customers & CX",
    name: "Lifecycle & tier classification",
    what: "New / active / at-risk / dormant from 30/90-day activity windows; value tiers calibrated to the real revenue distribution (p99/p95/p75).",
    trigger: "on view",
    guardrail: "runs itself",
    source: "supabase · live_customers()",
    status: "live",
  },
  {
    key: "wa_capture",
    dept: "Customers & CX",
    name: "WhatsApp message capture",
    what: "Signature-verified webhook is deployed and waiting; capture starts when the Meta app connects (official Cloud API, coexistence mode — ADR-0001).",
    trigger: "webhook",
    guardrail: "runs itself",
    source: "edge function · wa-webhook",
    status: "planned",
  },
  // ── Finance ───────────────────────────────────────────────────────────────
  {
    key: "contribution_gate",
    dept: "Finance",
    name: "Contribution coverage gate",
    what: "Contribution renders only when ≥90% of sold units carry a cost, per currency — and always states its coverage. Refuses to show margin built on thin data.",
    trigger: "on view",
    guardrail: "read-only",
    source: "web · live scorecard",
    status: "live",
    link: { href: "/command-center", label: "Command Centre" },
    health: (h) => `${n(h.costs?.costed_variants)}/${n(h.costs?.total_variants)} variants costed`,
  },
  {
    key: "commission",
    dept: "Finance",
    name: "Commission rules",
    what: "Derivable from mapped unit economics once Finance defines the scheme: who earns, on what basis (revenue vs contribution), at what rates.",
    trigger: "on view",
    guardrail: "read-only",
    source: "planned · needs Finance scheme",
    status: "planned",
  },
];

const GUARDRAIL_TONE: Record<Guardrail, string> = {
  "runs itself": "border-info/30 text-info",
  "suggest-only": "border-warning/30 text-warning",
  "human-confirm": "border-success/30 text-success",
  "read-only": "text-muted-foreground",
};

const STATUS_TONE: Record<Status, string> = {
  live: "border-success/30 bg-success/10 text-success",
  "on hold": "border-warning/30 bg-warning/10 text-warning",
  planned: "text-muted-foreground",
};

function AutomationsInner() {
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAutomationHealth()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <PageBody>
        <PageHeader title="Automations" description="Automation registry." />
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </PageBody>
    );
  }
  if (!health) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading automations" />
      </PageBody>
    );
  }

  const live = REGISTRY.filter((e) => e.status === "live").length;
  const gated = REGISTRY.filter((e) => e.guardrail === "human-confirm" || e.guardrail === "suggest-only").length;
  const pending = REGISTRY.filter((e) => e.status !== "live").length;
  const failed24 = n(health.woo_orders?.failed_24h);

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title="Automations"
        description="Every rule that runs without a human — defined in code or in-app — grouped by the department that owns the outcome. No invisible automation: each entry names its trigger, its guardrail, and its live health."
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Live automations", value: String(live) },
          { label: "Human-gated or suggest-only", value: String(gated) },
          { label: "Planned / on hold", value: String(pending), tone: "text-muted-foreground" },
          { label: "Sync failures (24h)", value: String(failed24), tone: failed24 > 0 ? "text-destructive" : "text-success" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={cn("tnum mt-0.5 text-lg font-semibold", m.tone)}>{m.value}</div>
          </div>
        ))}
      </section>

      {DEPT_ORDER.map((dept) => {
        const entries = REGISTRY.filter((e) => e.dept === dept);
        if (entries.length === 0) return null;
        return (
          <Card key={dept}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Zap className="size-4 text-warning" aria-hidden />
                {dept}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 pb-2 font-medium">Automation</th>
                      <th className="px-3 pb-2 font-medium">Trigger</th>
                      <th className="px-3 pb-2 font-medium">Guardrail</th>
                      <th className="px-3 pb-2 font-medium">Health</th>
                      <th className="px-3 pb-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const healthLine = e.status === "live" ? (e.health?.(health) ?? null) : null;
                      return (
                        <tr key={e.key} className={cn("border-b align-top last:border-0", e.status !== "live" && "opacity-70")}>
                          <td className="max-w-96 px-3 py-2.5">
                            <div className="font-medium">{e.name}</div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{e.what}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{e.source}</span>
                              {e.link && (
                                <Link href={e.link.href} className="text-[11px] text-info underline-offset-2 hover:underline">
                                  {e.link.label} →
                                </Link>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{e.trigger}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <Badge variant="outline" className={cn("text-[10px]", GUARDRAIL_TONE[e.guardrail])}>
                              {e.guardrail}
                            </Badge>
                          </td>
                          <td className="tnum px-3 py-2.5 text-xs text-muted-foreground">
                            {healthLine ?? (e.status === "live" ? "deterministic · no run state" : "—")}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[e.status])}>
                              {e.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        Guardrails: <span className="text-info">runs itself</span> = deterministic, no judgement calls ·{" "}
        <span className="text-warning">suggest-only</span> = proposes, never applies ·{" "}
        <span className="text-success">human-confirm</span> = a person clicks before anything changes ·
        read-only = computes a view, touches nothing. Writes to external systems require the ADR-0002
        stakeholder gate. Every human-triggered execution lands in the audit trail.
      </p>
    </PageBody>
  );
}

export default function AutomationsPage() {
  return (
    <LiveGuard>
      <AutomationsInner />
    </LiveGuard>
  );
}
