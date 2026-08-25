"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, RefreshChip, SkeletonTable } from "@/components/states";
import { tonePill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import { CONTAINED_UNIT_TYPES, PACK_STATUS_TONE, PRESENTATION_TYPES, type PackConfiguration } from "@/lib/domain/inventory-registry";
import { approvePackConfiguration, fetchInventoryRegistry, savePackConfiguration } from "@/lib/supabase/live";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }) : "—";
}

/**
 * Versioned pack master. Saving creates a new draft version; approving
 * supersedes the previous approved row. History is never rewritten, so
 * past orders and batches keep the configuration they were made under.
 */
export default function PackConfigurationsPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="catalog.view">
        <PackInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function PackInner() {
  const canApprove = usePermission("settings.manage");
  const canOperate = usePermission("orders.approve");
  const canDraft = canApprove || canOperate;
  const reg = useLiveQuery(fetchInventoryRegistry, []);
  const [drafting, setDrafting] = useState<PackConfiguration | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const rows = useMemo(() => reg.data?.pack_configurations ?? [], [reg.data]);
  const latestByVariant = useMemo(() => {
    const m = new Map<number, PackConfiguration>();
    for (const c of rows) if (!m.has(c.variant_id)) m.set(c.variant_id, c);
    return m;
  }, [rows]);
  const approvedCount = rows.filter((c) => c.status === "approved").length;

  const approve = async (c: PackConfiguration) => {
    setBusy(c.id);
    try {
      await approvePackConfiguration(c.id, null);
      toast.success(`v${c.version} approved for ${c.sku}`);
      await reg.reload();
    } catch (e) {
      toast.error("Could not approve", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageBody>
      <PageHeader title="Pack configurations" description="What one sellable pack contains, versioned. Drives production and packaging requirements, WIP→sellable conversion, channel stock and the customer depletion window." />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="h-5 font-normal">{approvedCount} approved · {latestByVariant.size} variants</Badge>
        <span>Seeded v1 drafts come from `units_per_pack` (base units per package) — they are placeholders until a governed capsule/sachet configuration is approved.</span>
        {reg.refreshing && <RefreshChip />}
      </div>
      {reg.error ? (
        <ErrorState title="Could not load pack configurations" description={reg.error} retry={() => void reg.reload()} />
      ) : reg.loading ? (
        <SkeletonTable rows={8} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Variant</th>
                <th className="px-3 py-2 font-medium">v</th>
                <th className="px-3 py-2 font-medium">Presentation</th>
                <th className="px-3 py-2 text-right font-medium">Contains</th>
                <th className="px-3 py-2 text-right font-medium" title="Approved consumption assumption for planning / CRM — not medical inference">Units / day</th>
                <th className="px-3 py-2 text-right font-medium">Days supply</th>
                <th className="px-3 py-2 font-medium">Effective</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className={c.status === "superseded" ? "text-muted-foreground" : ""}>
                  <td className="px-3 py-1.5"><span className="font-medium">{c.sku}</span><div className="text-[11px] text-muted-foreground">{c.product ?? ""}{c.variant_name ? ` · ${c.variant_name}` : ""}</div></td>
                  <td className="tnum px-3 py-1.5">{c.version}</td>
                  <td className="px-3 py-1.5">{c.presentation_type.replace(/_/g, " ")} · {c.sellable_uom}</td>
                  <td className="tnum px-3 py-1.5 text-right">{c.contained_units_per_pack} {c.contained_unit_type}{c.contained_units_per_pack === 1 ? "" : "s"}</td>
                  <td className="tnum px-3 py-1.5 text-right">{c.recommended_units_per_day ?? "—"}</td>
                  <td className="tnum px-3 py-1.5 text-right">{c.nominal_days_supply ?? "—"}</td>
                  <td className="tnum px-3 py-1.5">{when(c.effective_from)}{c.effective_to ? ` → ${when(c.effective_to)}` : ""}</td>
                  <td className="px-3 py-1.5">{tonePill({ label: c.status, tone: PACK_STATUS_TONE[c.status] })}{c.approved_by && <div className="text-[11px] text-muted-foreground">{c.approved_by}</div>}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1">
                      {c.status === "draft" && canApprove && (
                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" disabled={busy !== null} onClick={() => void approve(c)}>
                          {busy === c.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Approve"}
                        </Button>
                      )}
                      {canDraft && latestByVariant.get(c.variant_id)?.id === c.id && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={busy !== null} onClick={() => setDrafting(c)}>
                          <Plus className="size-3" aria-hidden /> New version
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drafting && <DraftDialog base={drafting} onClose={() => setDrafting(null)} onSaved={() => { setDrafting(null); void reg.reload(); }} />}
    </PageBody>
  );
}

function DraftDialog({ base, onClose, onSaved }: { base: PackConfiguration; onClose: () => void; onSaved: () => void }) {
  const [presentation, setPresentation] = useState<string>(base.presentation_type);
  const [unitType, setUnitType] = useState<string>(base.contained_unit_type);
  const [units, setUnits] = useState(String(base.contained_units_per_pack));
  const [uom, setUom] = useState(base.sellable_uom);
  const [perDay, setPerDay] = useState(base.recommended_units_per_day ? String(base.recommended_units_per_day) : "");
  const [bom, setBom] = useState(base.packaging_bom_version ?? "");
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const derivedDays = Number(units) > 0 && Number(perDay) > 0 ? (Number(units) / Number(perDay)).toFixed(1) : null;

  const save = async () => {
    setBusy(true);
    try {
      await savePackConfiguration({
        variantId: base.variant_id, presentationType: presentation, containedUnitType: unitType, containedUnitsPerPack: Number(units), sellableUom: uom,
        contentPerUnit: null, recommendedUnitsPerDay: perDay ? Number(perDay) : null, nominalDaysSupply: null, packagingBomVersion: bom.trim() || null, effectiveFrom: effective, note: note.trim() || null,
      });
      toast.success(`Draft v${base.version + 1} saved for ${base.sku}`);
      onSaved();
    } catch (e) {
      toast.error("Could not save the draft", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New pack configuration · {base.sku}</DialogTitle>
          <DialogDescription>Creates draft v{base.version + 1}. It takes effect only when an HQ admin approves it; the previous approved version is superseded, never edited.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pc-pres">Presentation</Label>
              <Select value={presentation} onValueChange={setPresentation}><SelectTrigger id="pc-pres"><SelectValue /></SelectTrigger><SelectContent>{PRESENTATION_TYPES.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="pc-uom">Sellable UOM</Label><Input id="pc-uom" value={uom} onChange={(e) => setUom(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pc-unit">Contained unit</Label>
              <Select value={unitType} onValueChange={setUnitType}><SelectTrigger id="pc-unit"><SelectValue /></SelectTrigger><SelectContent>{CONTAINED_UNIT_TYPES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="pc-n">Units per pack</Label><Input id="pc-n" type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} className="tnum" /></div>
            <div className="grid gap-1.5"><Label htmlFor="pc-day">Units / day</Label><Input id="pc-day" type="number" min={0} step="0.5" value={perDay} onChange={(e) => setPerDay(e.target.value)} className="tnum" /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Nominal days supply {derivedDays ? `= ${derivedDays} d (derived)` : "is derived only when units/day is set"} — an approved planning assumption, never a medical inference.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pc-bom">Packaging BOM version</Label><Input id="pc-bom" value={bom} onChange={(e) => setBom(e.target.value)} placeholder="e.g. bottle-cap-label v2" /></div>
            <div className="grid gap-1.5"><Label htmlFor="pc-eff">Effective from</Label><Input id="pc-eff" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="pc-note">Note (audit)</Label><Textarea id="pc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || Number(units) < 1}>{busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
