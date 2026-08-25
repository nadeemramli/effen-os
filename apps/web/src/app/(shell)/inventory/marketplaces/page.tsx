"use client";

import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState, RefreshChip, SkeletonTable } from "@/components/states";
import { tonePill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import { APPROVAL_TONE, CUTOVER_TONE, PLATFORM_LABELS, type MarketplaceAccount } from "@/lib/domain/inventory-registry";
import { fetchMarketplaceRegistry, setMarketplaceCutover } from "@/lib/supabase/live";

/**
 * Per-account marketplace registry with cutover mode (plan §6.2) and the
 * listing→variant mapping grain (§6.3). ADR-0009: partner track, read scopes
 * only; the server refuses pilot_write / live. No connector exists yet, and
 * the page says why.
 */
export default function MarketplacesPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="integrations.view">
        <MarketplacesInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function MarketplacesInner() {
  const canManage = usePermission("settings.manage");
  const reg = useLiveQuery(fetchMarketplaceRegistry, []);
  const [busy, setBusy] = useState<number | null>(null);
  const d = reg.data;

  const cutover = async (a: MarketplaceAccount, mode: string) => {
    setBusy(a.id);
    try {
      await setMarketplaceCutover(a.id, mode, null);
      toast.success(`${a.account_label}: cutover ${mode}`);
      await reg.reload();
    } catch (e) {
      toast.error("Cutover refused", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageBody>
      <PageHeader title="Marketplaces" description="Every seller account with its approval position, scopes, capabilities, source-of-truth map and cutover mode. Orders and stock come only after a proven read-only mirror." />
      <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <ShieldAlert className="size-3.5 text-warning" aria-hidden />
        <span className="text-muted-foreground">{d?.posture ?? "ADR-0009: partner track, read scopes only."}</span>
        {d && <a href="#" className="text-info underline-offset-2 hover:underline" onClick={(e) => e.preventDefault()} title={d.onboarding_register}>register: {d.onboarding_register}</a>}
        {reg.refreshing && <RefreshChip />}
      </div>
      {reg.error ? (
        <ErrorState title="Could not load the marketplace registry" description={reg.error} retry={() => void reg.reload()} />
      ) : reg.loading ? (
        <SkeletonTable rows={4} />
      ) : d ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {d.accounts.map((a) => (
              <Card key={a.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm font-medium">{PLATFORM_LABELS[a.platform]} · {a.market}</CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{a.account_label} · {a.legal_entity ?? "entity to confirm"} · {a.currency_code}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {tonePill({ label: `approval: ${a.approval_state.replace(/_/g, " ")}`, tone: APPROVAL_TONE[a.approval_state] ?? "neutral" })}
                    {tonePill({ label: `cutover: ${a.cutover_mode.replace(/_/g, " ")}`, tone: CUTOVER_TONE[a.cutover_mode] })}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {a.app_state && <p><span className="text-muted-foreground">App: </span>{a.app_state}</p>}
                  <p><span className="text-muted-foreground">Scopes requested: </span>{a.scopes_requested.length ? a.scopes_requested.join(", ") : "—"}<span className="text-muted-foreground"> · granted: </span>{a.scopes_granted.length ? a.scopes_granted.join(", ") : "none"}</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(a.capabilities).map(([k, v]) => (
                      <Badge key={k} variant="outline" className={`h-5 font-normal ${v ? "" : "text-muted-foreground"}`}>{k.replace(/_/g, " ")}: {v ? "yes" : "no"}</Badge>
                    ))}
                  </div>
                  <p className="text-muted-foreground">Authority — {Object.entries(a.authority).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v).replace(/_/g, " ")}`).join(" · ")}</p>
                  <p className="tnum text-muted-foreground">listings {a.listings} · unmapped {a.unmapped_listings} · reconciliation {a.reconciliation_status}</p>
                  {a.notes && <p className="text-muted-foreground">{a.notes}</p>}
                  {canManage && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-muted-foreground">Cutover</span>
                      <Select value={a.cutover_mode} onValueChange={(v) => void cutover(a, v)} disabled={busy !== null}>
                        <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="disconnected">disconnected</SelectItem>
                          <SelectItem value="read_only">read only (needs approval)</SelectItem>
                          <SelectItem value="shadow">shadow (needs read only)</SelectItem>
                          <SelectItem value="pilot_write" disabled>pilot write — refused (ADR-0009)</SelectItem>
                          <SelectItem value="live" disabled>live — refused (ADR-0009)</SelectItem>
                        </SelectContent>
                      </Select>
                      {busy === a.id && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Listing mapping</CardTitle></CardHeader>
            <CardContent>
              {d.listings.length === 0 ? (
                <EmptyState title="No listings mirrored" description={d.connector.reason} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="py-1.5 pr-2 font-medium">Account</th><th className="py-1.5 pr-2 font-medium">Listing / variation</th><th className="py-1.5 pr-2 font-medium">Source SKU</th><th className="py-1.5 pr-2 font-medium">Mapping</th><th className="py-1.5 font-medium">Variant</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {d.listings.map((l) => (
                        <tr key={l.id}>
                          <td className="py-1.5 pr-2">{d.accounts.find((a) => a.id === l.account_id)?.account_label ?? l.account_id}</td>
                          <td className="tnum py-1.5 pr-2">{l.listing_id}{l.variation_id ? ` / ${l.variation_id}` : ""}</td>
                          <td className="py-1.5 pr-2">{l.source_sku ?? "—"}</td>
                          <td className="py-1.5 pr-2">{tonePill({ label: l.mapping_status, tone: l.mapping_status === "mapped" ? "success" : l.mapping_status === "unmapped" ? "warning" : "info" })}</td>
                          <td className="tnum py-1.5">{l.variant_id ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">Mapping grain: marketplace + account + listing + variation → canonical variant → finished-good item. Unmapped or ambiguous lines can never reserve stock.</p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageBody>
  );
}
