"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Factory, History, Loader2, Plus, Ship, Plane } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  cancelProductionInbound,
  deleteProductionMaterial,
  fetchLiveCatalog,
  fetchLiveProduction,
  markInboundArrived,
  saveProductionInbound,
  saveProductionItem,
  saveProductionMaterial,
  setProductionStage,
  setVariantUnitsPerPack,
  type LiveProduct,
  type LiveProduction,
  type LiveProductionItem,
  type ProductionInbound,
  type ProductionMaterial,
} from "@/lib/supabase/live";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Production pipeline (P5 slice 0): per-product factory tracking. Stage
 * counters (raw material → premix → in-progress → in-stock) are manual,
 * audited, and explained by an append-only ledger; backlog is COMPUTED from
 * unfulfilled orders; days-of-cover from real sales velocity. Returns
 * (courier RTS + refunds) are surfaced as signals only — physical returns
 * are counted back in by an operator.
 */

const STAGE_LABEL: Record<string, string> = {
  raw_material_units: "Raw material",
  premix_units: "Premix",
  in_progress_units: "In-progress",
  ready_units: "In-stock",
};

const FREIGHT_LABEL: Record<string, string> = { sea: "Sea", air: "Air", sea_air: "Sea + Air" };

function rel(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ProductionInner() {
  const [data, setData] = useState<LiveProduction | null>(null);
  const [products, setProducts] = useState<LiveProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stageTarget, setStageTarget] = useState<{ item: LiveProductionItem; field: string } | null>(null);
  const [materialTarget, setMaterialTarget] = useState<{ item: LiveProductionItem; material: ProductionMaterial | null } | null>(null);
  const [inboundTarget, setInboundTarget] = useState<{ item: LiveProductionItem; inbound: ProductionInbound | null } | null>(null);
  const [itemDialog, setItemDialog] = useState<LiveProductionItem | "new" | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const reload = useCallback(() => {
    fetchLiveProduction()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    reload();
    fetchLiveCatalog()
      .then(({ products: p }) => setProducts(p))
      .catch(() => setProducts([]));
  }, [reload]);

  if (error) {
    return (
      <PageBody>
        <PageHeader title="Production" description="Factory pipeline." />
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading production" />
      </PageBody>
    );
  }

  const items = data.items;
  const totals = {
    ready: items.reduce((s, i) => s + i.ready_units, 0),
    backlog: items.reduce((s, i) => s + i.backlog_units, 0),
    incoming: items.reduce((s, i) => s + i.incoming_units, 0),
  };
  const toggle = (id: number) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title="Production"
        description="Raw material → premix → in-progress → in-stock, per product in base units. Backlog is computed from unfulfilled orders; every count change is audited and ledger-explained."
      >
        <Button size="sm" className="gap-1.5" onClick={() => setItemDialog("new")}>
          <Plus className="size-3.5" aria-hidden /> New product line
        </Button>
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Product lines", value: items.length.toLocaleString() },
          { label: "In-stock units", value: totals.ready.toLocaleString() },
          { label: "Backlog units", value: totals.backlog.toLocaleString(), tone: totals.backlog > 0 ? "text-destructive" : "text-success" },
          { label: "Incoming raw material", value: totals.incoming.toLocaleString() },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={cn("tnum mt-0.5 text-lg font-semibold", m.tone)}>{m.value}</div>
          </div>
        ))}
      </section>

      {(data.variants_missing_pack.length > 0 || data.unmapped_backlog_qty > 0) && (
        <div className="space-y-1.5 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
          {data.variants_missing_pack.length > 0 && (
            <p>
              {data.variants_missing_pack.length} variant{data.variants_missing_pack.length === 1 ? "" : "s"} of tracked
              products still use the default pack size of 1 — backlog and cover are approximate until set.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => setPackOpen(true)}>
                Set pack sizes
              </button>
            </p>
          )}
          {data.unmapped_backlog_qty > 0 && (
            <p>
              {data.unmapped_backlog_qty.toLocaleString()} backlog line units carry store SKUs with no catalog mapping
              and are excluded from product backlogs.{" "}
              <Link href="/catalog" className="underline underline-offset-2">Mapping queue →</Link>
            </p>
          )}
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
          <Factory className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
          <h2 className="text-sm font-medium">No product lines yet</h2>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Create one per manufactured product (Synovil, Lipidri, Adipocyde…) and enter the counts from the factory
            sheet. Backlog and cover compute themselves from orders.
          </p>
        </div>
      )}

      {items.map((item) => {
        const isOpen = expanded.has(item.id);
        const stages: { field: string; value: number }[] = [
          { field: "raw_material_units", value: item.raw_material_units },
          { field: "premix_units", value: item.premix_units },
          ...(item.dosage_form === "sachet" ? [{ field: "in_progress_units", value: item.in_progress_units }] : []),
          { field: "ready_units", value: item.ready_units },
        ];
        return (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <button type="button" onClick={() => toggle(item.id)} className="flex items-center gap-1.5">
                    {isOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                    {item.name}
                  </button>
                  <Badge variant="outline" className="text-[10px]">{item.dosage_form}</Badge>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">{item.base_uom}</Badge>
                  {item.product_id === null && (
                    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">
                      not in catalog — backlog unavailable
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {item.daily_usage > 0 && (
                    <span className="tnum">
                      {item.daily_usage}/day{item.days_cover !== null && ` · ±${item.days_cover} days cover`}
                    </span>
                  )}
                  <LedgerPopover item={item} />
                  <button
                    type="button"
                    className="text-info underline-offset-2 hover:underline"
                    onClick={() => setItemDialog(item)}
                  >
                    edit
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {stages.map((s) => (
                  <button
                    key={s.field}
                    type="button"
                    onClick={() => setStageTarget({ item, field: s.field })}
                    className="rounded-lg border bg-card px-3 py-2 text-left hover:border-info/40 hover:bg-accent/30"
                  >
                    <div className="text-[11px] text-muted-foreground">{STAGE_LABEL[s.field]}</div>
                    <div className="tnum mt-0.5 text-base font-semibold">{s.value.toLocaleString()}</div>
                  </button>
                ))}
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Backlog (computed)</div>
                  <div className={cn("tnum mt-0.5 text-base font-semibold", item.backlog_units > 0 && "text-destructive")}>
                    {item.backlog_units.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Net position</div>
                  <div className={cn("tnum mt-0.5 text-base font-semibold", item.net_position < 0 ? "text-destructive" : "text-success")}>
                    {item.net_position.toLocaleString()}
                  </div>
                </div>
              </div>

              {(item.rts_parcels_30d > 0 || item.refund_units_30d > 0) && (
                <p className="text-[11px] text-warning">
                  Returns 30d: {item.rts_parcels_30d} RTS parcel{item.rts_parcels_30d === 1 ? "" : "s"} (~{item.rts_units_30d} units)
                  · {item.refund_units_30d} refunded/cancelled units — signals only; count physical returns back into
                  In-stock manually.
                </p>
              )}

              {isOpen && (
                <div className="grid grid-cols-1 gap-4 border-t pt-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Raw materials</span>
                      <button
                        type="button"
                        className="text-[11px] text-info underline-offset-2 hover:underline"
                        onClick={() => setMaterialTarget({ item, material: null })}
                      >
                        + add material
                      </button>
                    </div>
                    {item.materials.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None listed yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {item.materials.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 text-xs">
                            <Badge variant="outline" className="w-20 justify-center text-[10px]">{m.kind}</Badge>
                            <span className="min-w-0 flex-1 truncate">{m.name}</span>
                            <span className="tnum text-muted-foreground">{Number(m.qty).toLocaleString()} {m.uom}</span>
                            <button
                              type="button"
                              className="text-[11px] text-info underline-offset-2 hover:underline"
                              onClick={() => setMaterialTarget({ item, material: m })}
                            >
                              edit
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Incoming raw material{item.incoming_units > 0 && ` · ${item.incoming_units.toLocaleString()} units in transit`}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] text-info underline-offset-2 hover:underline"
                        onClick={() => setInboundTarget({ item, inbound: null })}
                      >
                        + add shipment
                      </button>
                    </div>
                    {item.incoming.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing on the way.</p>
                    ) : (
                      <ul className="space-y-1">
                        {item.incoming.map((s) => (
                          <li key={s.id} className="flex items-center gap-2 text-xs">
                            {s.freight === "sea" ? <Ship className="size-3 text-muted-foreground" aria-hidden /> : <Plane className="size-3 text-muted-foreground" aria-hidden />}
                            <span className="tnum">{s.qty_units.toLocaleString()} units</span>
                            <Badge variant="outline" className="text-[10px]">{FREIGHT_LABEL[s.freight]}</Badge>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {s.eta ? `ETA ${s.eta}` : "no ETA"}{s.note ? ` · ${s.note}` : ""}
                            </span>
                            <button
                              type="button"
                              className="text-[11px] text-info underline-offset-2 hover:underline"
                              onClick={() => setInboundTarget({ item, inbound: s })}
                            >
                              edit
                            </button>
                            <ArriveButton inbound={s} onDone={reload} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        Counts are manual, audited operator entries — every change lands in the ledger and the audit trail. Backlog =
        unfulfilled orders (pending / on-hold / processing, not yet handed to the courier) converted to base units via
        variant pack sizes. Deferred: BOM-driven premix math, work orders, lots/expiry, per-variant allocation,
        automatic stock deduction on ship.
      </p>

      <StageDialog
        key={stageTarget ? `${stageTarget.item.id}·${stageTarget.field}` : "stage-none"}
        target={stageTarget}
        onClose={() => setStageTarget(null)}
        onSaved={reload}
      />
      <MaterialDialog
        key={materialTarget ? `${materialTarget.item.id}·${materialTarget.material?.id ?? "new"}` : "mat-none"}
        target={materialTarget}
        onClose={() => setMaterialTarget(null)}
        onSaved={reload}
      />
      <InboundDialog
        key={inboundTarget ? `${inboundTarget.item.id}·${inboundTarget.inbound?.id ?? "new"}` : "in-none"}
        target={inboundTarget}
        onClose={() => setInboundTarget(null)}
        onSaved={reload}
      />
      <ItemDialog
        key={itemDialog === null ? "item-none" : itemDialog === "new" ? "item-new" : `item-${itemDialog.id}`}
        target={itemDialog}
        products={products}
        existing={items}
        onClose={() => setItemDialog(null)}
        onSaved={reload}
      />
      <PackSizeDialog open={packOpen} variants={data.variants_missing_pack} onClose={() => setPackOpen(false)} onSaved={reload} />
    </PageBody>
  );
}

function LedgerPopover({ item }: { item: LiveProductionItem }) {
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" aria-label="Recent changes">
        <History className="size-3.5" aria-hidden /> ledger
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 text-xs">
        {item.entries.length === 0 ? (
          <p className="text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {item.entries.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="tnum whitespace-nowrap font-medium">
                  {STAGE_LABEL[e.field]} {e.old_qty.toLocaleString()} → {e.new_qty.toLocaleString()}
                  <span className={cn("ml-1", e.delta >= 0 ? "text-success" : "text-destructive")}>
                    ({e.delta >= 0 ? "+" : ""}{e.delta.toLocaleString()})
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {e.source === "inbound_arrival" ? "inbound arrival" : (e.note ?? "manual")} · {e.actor} · {rel(e.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ArriveButton({ inbound, onDone }: { inbound: ProductionInbound; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] text-success hover:bg-success/20 disabled:opacity-50"
      onClick={async () => {
        if (!window.confirm(`Mark ${inbound.qty_units.toLocaleString()} units as arrived? This rolls them into Raw material automatically.`)) return;
        setBusy(true);
        try {
          await markInboundArrived(inbound.id);
          toast.success("Shipment arrived", { description: `${inbound.qty_units.toLocaleString()} units rolled into raw material.` });
          onDone();
        } catch (e) {
          toast.error("Could not mark arrived", { description: (e as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : "mark arrived"}
    </button>
  );
}

function StageDialog({
  target, onClose, onSaved,
}: {
  target: { item: LiveProductionItem; field: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = target
    ? (target.item[target.field as keyof LiveProductionItem] as number)
    : 0;
  const [qty, setQty] = useState(String(current));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const parsed = Number(qty);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {STAGE_LABEL[target.field]} — {target.item.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="stage-qty">New count ({target.item.base_uom}s)</Label>
            <Input id="stage-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Currently {current.toLocaleString()}. {target.field === "premix_units" && "Premix is measured in finished-good output units, not kg."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stage-note">Note (for the ledger)</Label>
            <Input id="stage-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. batch 240 bottled" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !valid || parsed === current}
            onClick={async () => {
              setBusy(true);
              try {
                await setProductionStage(target.item.id, target.field, parsed, note || undefined);
                toast.success("Count updated", {
                  description: `${STAGE_LABEL[target.field]}: ${current.toLocaleString()} → ${parsed.toLocaleString()}`,
                });
                onSaved();
                onClose();
              } catch (e) {
                toast.error("Could not update count", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaterialDialog({
  target, onClose, onSaved,
}: {
  target: { item: LiveProductionItem; material: ProductionMaterial | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const m = target?.material ?? null;
  const [kind, setKind] = useState<string>(m?.kind ?? "product");
  const [name, setName] = useState(m?.name ?? "");
  const [uom, setUom] = useState(m?.uom ?? "kg");
  const [qty, setQty] = useState(m ? String(m.qty) : "0");
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const parsed = Number(qty);
  const valid = name.trim() !== "" && uom.trim() !== "" && !Number.isNaN(parsed) && parsed >= 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{m ? "Edit material" : "Add material"} — {target.item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="product">Product raw material</SelectItem>
                <SelectItem value="packaging">Packaging</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mat-name">Name</Label>
            <Input id="mat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Collagen powder / Bottles 500ml" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="mat-qty">Quantity</Label>
              <Input id="mat-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-uom">Unit</Label>
              <Input id="mat-uom" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="kg / pcs / roll" />
            </div>
          </div>
        </div>
        <DialogFooter className="justify-between">
          {m ? (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteProductionMaterial(m.id);
                  toast.success("Material removed");
                  onSaved();
                  onClose();
                } catch (e) {
                  toast.error("Could not remove material", { description: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={busy || !valid}
              onClick={async () => {
                setBusy(true);
                try {
                  await saveProductionMaterial({
                    itemId: target.item.id, kind, name: name.trim(), uom: uom.trim(), qty: parsed,
                    materialId: m?.id ?? null,
                  });
                  toast.success("Material saved");
                  onSaved();
                  onClose();
                } catch (e) {
                  toast.error("Could not save material", { description: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InboundDialog({
  target, onClose, onSaved,
}: {
  target: { item: LiveProductionItem; inbound: ProductionInbound | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = target?.inbound ?? null;
  const [qty, setQty] = useState(s ? String(s.qty_units) : "");
  const [freight, setFreight] = useState<string>(s?.freight ?? "sea");
  const [eta, setEta] = useState(s?.eta ?? "");
  const [note, setNote] = useState(s?.note ?? "");
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const parsed = Number(qty);
  const valid = Number.isInteger(parsed) && parsed > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{s ? "Edit shipment" : "Incoming raw material"} — {target.item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="in-qty">Quantity (unit-equivalents of {target.item.base_uom}s)</Label>
            <Input id="in-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Freight</Label>
            <Select value={freight} onValueChange={setFreight}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sea">Sea</SelectItem>
                <SelectItem value="air">Air</SelectItem>
                <SelectItem value="sea_air">Sea + Air</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-eta">ETA (optional)</Label>
            <Input id="in-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-note">Note</Label>
            <Input id="in-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="supplier / PO ref" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            When it lands, use “mark arrived” — the quantity rolls into Raw material automatically (single entry, ledger-recorded).
          </p>
        </div>
        <DialogFooter className="justify-between">
          {s ? (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await cancelProductionInbound(s.id);
                  toast.success("Shipment cancelled");
                  onSaved();
                  onClose();
                } catch (e) {
                  toast.error("Could not cancel", { description: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel shipment
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button
              disabled={busy || !valid}
              onClick={async () => {
                setBusy(true);
                try {
                  await saveProductionInbound({
                    itemId: target.item.id, qtyUnits: parsed, freight,
                    eta: eta || null, note: note || undefined, inboundId: s?.id ?? null,
                  });
                  toast.success("Shipment saved");
                  onSaved();
                  onClose();
                } catch (e) {
                  toast.error("Could not save shipment", { description: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemDialog({
  target, products, existing, onClose, onSaved,
}: {
  target: LiveProductionItem | "new" | null;
  products: LiveProduct[];
  existing: LiveProductionItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const item = target === "new" ? null : target;
  const [name, setName] = useState(item?.name ?? "");
  const [form, setForm] = useState<string>(item?.dosage_form ?? "capsule");
  const [uom, setUom] = useState(item?.base_uom ?? "bottle");
  const [productId, setProductId] = useState<string>(item?.product_id ? String(item.product_id) : "none");
  const [busy, setBusy] = useState(false);
  if (target === null) return null;
  const linkedElsewhere = new Set(existing.filter((e) => e.id !== item?.id).map((e) => e.product_id));
  const valid = name.trim() !== "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{item ? "Edit product line" : "New product line"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adipocyde" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={form} onValueChange={setForm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="capsule">Capsule (no in-progress)</SelectItem>
                  <SelectItem value="sachet">Sachet</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-uom">Base unit</Label>
              <Input id="item-uom" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="bottle / box" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Catalog product (enables backlog & cover)</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not in catalog yet</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)} disabled={linkedElsewhere.has(p.id)}>
                    {p.name}{linkedElsewhere.has(p.id) ? " (linked)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !valid}
            onClick={async () => {
              setBusy(true);
              try {
                await saveProductionItem({
                  name: name.trim(), dosageForm: form, baseUom: uom.trim() || "bottle",
                  productId: productId === "none" ? null : Number(productId),
                  itemId: item?.id ?? null,
                });
                toast.success(item ? "Product line updated" : "Product line created");
                onSaved();
                onClose();
              } catch (e) {
                toast.error("Could not save product line", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackSizeDialog({
  open, variants, onClose, onSaved,
}: {
  open: boolean;
  variants: { id: number; sku: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pack sizes (base units per variant)</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          How many base units (bottles/boxes) does one sale of each variant consume? A “Pakej 4+2” is 6.
          Backlog and cover use these factors.
        </p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {variants.map((v) => (
            <div key={v.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{v.name}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{v.sku}</div>
              </div>
              <Input
                className="w-20"
                inputMode="numeric"
                placeholder="1"
                value={values[v.id] ?? ""}
                onChange={(e) => setValues((cur) => ({ ...cur, [v.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            disabled={busy || !Object.values(values).some((v) => Number(v) > 1)}
            onClick={async () => {
              setBusy(true);
              try {
                const updates = Object.entries(values)
                  .map(([id, v]) => ({ id: Number(id), units: Number(v) }))
                  .filter((u) => Number.isInteger(u.units) && u.units > 0);
                for (const u of updates) {
                  await setVariantUnitsPerPack(u.id, u.units);
                }
                toast.success(`${updates.length} pack size${updates.length === 1 ? "" : "s"} saved`);
                onSaved();
                onClose();
              } catch (e) {
                toast.error("Could not save pack sizes", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductionPage() {
  return (
    <LiveGuard>
      <ProductionInner />
    </LiveGuard>
  );
}
