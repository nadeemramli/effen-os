"use client";

import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/tables/data-table";
import { MoneyCell } from "@/components/tables/cells";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { usePermission, useSession } from "@/hooks/use-session";
import type { Customer } from "@/lib/domain/types";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatRelative } from "@/lib/utils/dates";
import { maskPhone } from "@/lib/utils/mask";
import { cn } from "@/lib/utils";

function CustomersInner() {
  const router = useRouter();
  const session = useSession();
  const canSeePii = usePermission("customers.pii.view");
  const customers = useAppStore((s) => s.customers);
  const brands = useAppStore((s) => s.brands);

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [lifecycle, setLifecycle] = useQueryState("lifecycle", parseAsString.withDefault("any"));
  const [repeat, setRepeat] = useQueryState("repeat", parseAsString.withDefault("any"));
  const [tier, setTier] = useQueryState("tier", parseAsString.withDefault("any"));
  const [consent, setConsent] = useQueryState("consent", parseAsString.withDefault("any"));
  const [risk, setRisk] = useQueryState("risk", parseAsString.withDefault("any"));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (session.brandId !== "all" && !c.brandIds.includes(session.brandId)) return false;
        if (lifecycle !== "any" && c.lifecycleState !== lifecycle) return false;
        if (repeat !== "any" && c.repeatState !== repeat) return false;
        if (tier !== "any" && c.valueTier !== tier) return false;
        if (consent !== "any") {
          const wa = c.consents.find((x) => x.channel === "whatsapp" && x.purpose === "marketing");
          if (consent === "granted" && wa?.status !== "granted") return false;
          if (consent === "revoked" && wa?.status !== "revoked") return false;
        }
        if (risk === "service" && c.serviceRisk === "none") return false;
        if (risk === "cod" && c.codRiskScore < 40) return false;
        if (needle) {
          const hay = [c.displayName, c.id, ...c.identities.map((i) => i.value)].join(" ").toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.netRevenue - a.netRevenue);
  }, [customers, session.brandId, q, lifecycle, repeat, tier, consent, risk]);

  const columns = useMemo<ColumnDef<Customer, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Customer",
        accessorKey: "displayName",
        cell: ({ row }) => {
          const c = row.original;
          const phone = c.identities.find((i) => i.type === "phone")?.value ?? "";
          return (
            <div>
              <div className="font-medium">{c.displayName}</div>
              <div className="tnum text-[11px] text-muted-foreground">{maskPhone(phone, canSeePii)}</div>
            </div>
          );
        },
      },
      {
        id: "brands",
        header: "Brands",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.brandIds
              .map((id) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id)
              .join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "lifecycle",
        header: "Lifecycle",
        accessorKey: "lifecycleState",
        cell: ({ row }) => (
          <span
            className={cn(
              "capitalize",
              row.original.lifecycleState === "at_risk" && "text-warning",
              row.original.lifecycleState === "dormant" && "text-muted-foreground",
            )}
          >
            {row.original.lifecycleState.replace("_", " ")}
          </span>
        ),
      },
      {
        id: "repeat",
        header: "Repeat",
        accessorKey: "repeatState",
        cell: ({ row }) => <span className="capitalize">{row.original.repeatState.replace("_", " ")}</span>,
      },
      {
        id: "orders",
        header: "Orders",
        accessorKey: "lifetimeOrders",
        cell: ({ row }) => <span className="tnum">{row.original.lifetimeOrders}</span>,
      },
      {
        id: "netRevenue",
        header: "Net revenue",
        accessorKey: "netRevenue",
        cell: ({ row }) => (
          <MoneyCell minor={row.original.netRevenue} currency={row.original.primaryMarket === "SG" ? "SGD" : "MYR"} />
        ),
      },
      {
        id: "tier",
        header: "Tier",
        accessorKey: "valueTier",
        cell: ({ row }) => <span className="uppercase text-xs">{row.original.valueTier}</span>,
      },
      {
        id: "lastOrder",
        header: "Last order",
        accessorFn: (c) => c.lastOrderAt ?? "",
        cell: ({ row }) =>
          row.original.lastOrderAt ? (
            <span className="tnum text-muted-foreground">{formatRelative(row.original.lastOrderAt)}</span>
          ) : (
            <span className="text-muted-foreground">never</span>
          ),
      },
      {
        id: "risk",
        header: "Risk",
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex gap-1.5 text-[11px]">
              {c.serviceRisk !== "none" && <span className="text-warning">service</span>}
              {c.codRiskScore >= 40 && <span className="text-destructive">COD {c.codRiskScore}</span>}
              {c.returnRate > 0.2 && <span className="text-warning">returns</span>}
              {c.serviceRisk === "none" && c.codRiskScore < 40 && c.returnRate <= 0.2 && (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
    ],
    [brands, canSeePii],
  );

  const filtersActive = q !== "" || lifecycle !== "any" || repeat !== "any" || tier !== "any" || consent !== "any" || risk !== "any";

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Customers"
        description={`${filtered.length.toLocaleString()} resolved identities · contact details ${canSeePii ? "visible (Sales/CS scope)" : "masked for your role"}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value || null)}
          placeholder="Search name, phone, email…"
          className="h-8 w-64 text-sm"
          aria-label="Search customers"
        />
        <Select value={lifecycle} onValueChange={(v) => setLifecycle(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Lifecycle"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any lifecycle</SelectItem>
            {["new", "active", "at_risk", "dormant", "provisional"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={repeat} onValueChange={(v) => setRepeat(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Repeat state"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any repeat</SelectItem>
            <SelectItem value="first_time">First-time</SelectItem>
            <SelectItem value="repeat">Repeat</SelectItem>
            <SelectItem value="loyal">Loyal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={(v) => setTier(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Value tier"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any tier</SelectItem>
            {["vip", "high", "mid", "low"].map((t) => (
              <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={consent} onValueChange={(v) => setConsent(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Marketing consent"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any WA consent</SelectItem>
            <SelectItem value="granted">WA marketing granted</SelectItem>
            <SelectItem value="revoked">WA marketing revoked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={risk} onValueChange={(v) => setRisk(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Risk"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any risk</SelectItem>
            <SelectItem value="service">Service risk</SelectItem>
            <SelectItem value="cod">COD risk</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => { setQ(null); setLifecycle(null); setRepeat(null); setTier(null); setConsent(null); setRisk(null); }}>
            <X className="size-3" aria-hidden /> Clear
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        emptyTitle="No customers match"
        emptyDescription="Adjust filters. Identity data comes from RudderStack — currently 14h stale, so recent identities may not have landed yet."
      />
    </PageBody>
  );
}

export default function CustomersPage() {
  return (
    <RouteGuard permission="customers.view">
      <CustomersInner />
    </RouteGuard>
  );
}
