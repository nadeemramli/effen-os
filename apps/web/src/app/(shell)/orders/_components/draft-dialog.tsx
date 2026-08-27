"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { draftTotal, type DraftItem, type OrderDraft } from "@/lib/domain/order-qc";
import { saveOrderDraft, type LiveWooConnection } from "@/lib/supabase/live";

export function money(ccy: string, v: number): string {
  return `${ccy === "MYR" ? "RM" : ccy === "SGD" ? "S$" : ccy} ${v.toFixed(2)}`;
}

export function storeLabel(c: LiveWooConnection | undefined): string {
  return c?.name.match(/—\s*(.+?)\s*\(/)?.[1] ?? c?.name ?? "—";
}

const EMPTY_ITEM: DraftItem = { sku: "", name: "", quantity: 1, unit_price: 0 };

/**
 * Manual-order composer over server-side drafts (R19). Saving is idempotent
 * per dialog instance; the draft is audited and can be left half-done. No
 * stock is reserved, no courier is booked and nothing reaches the store —
 * confirming (on the Drafts page) enrols the draft in New / QC, and the store
 * order is created only when the write path is enabled.
 */
export function DraftDialog({ draft, connections, onClose, onSaved, title }: {
  draft: OrderDraft | null;
  connections: LiveWooConnection[];
  onClose: () => void;
  onSaved: () => void;
  /** Overrides the dialog title (e.g. "Make order" from the Orders section). */
  title?: string;
}) {
  const [store, setStore] = useState<string>(draft ? String(draft.integration_id) : connections[0] ? String(connections[0].id) : "");
  const [customer, setCustomer] = useState({ name: draft?.customer.name ?? "", phone: draft?.customer.phone ?? "", email: draft?.customer.email ?? "" });
  const [shipping, setShipping] = useState({
    address_1: draft?.shipping.address_1 ?? "",
    address_2: draft?.shipping.address_2 ?? "",
    city: draft?.shipping.city ?? "",
    state: draft?.shipping.state ?? "",
    postcode: draft?.shipping.postcode ?? "",
  });
  const [items, setItems] = useState<DraftItem[]>(draft?.items.length ? draft.items : [EMPTY_ITEM]);
  const [payment, setPayment] = useState<OrderDraft["payment_method"]>(draft?.payment_method ?? "cod");
  const [note, setNote] = useState(draft?.note ?? "");
  const [busy, setBusy] = useState(false);
  // One key per dialog instance → a double-click or retry cannot create two drafts.
  const [idempotencyKey] = useState(() => `draft-${crypto.randomUUID()}`);

  const conn = connections.find((c) => String(c.id) === store);
  const ccy = conn?.config?.country_code === "SG" ? "SGD" : "MYR";
  const valid = store !== "" && items.some((i) => (i.sku || i.name) && Number(i.quantity) > 0 && Number(i.unit_price) >= 0);

  const save = async () => {
    setBusy(true);
    try {
      const cleaned = items
        .filter((i) => (i.sku || i.name) && Number(i.quantity) > 0)
        .map((i) => ({ sku: i.sku || null, name: i.name || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
      await saveOrderDraft({
        id: draft?.id ?? null,
        integrationId: draft ? null : Number(store),
        customer: { name: customer.name.trim(), phone: customer.phone.trim(), email: customer.email.trim() || undefined },
        shipping,
        items: cleaned,
        paymentMethod: payment,
        note: note.trim() || null,
        idempotencyKey: draft ? null : idempotencyKey,
        expectedVersion: draft?.version ?? null,
      });
      toast.success(draft ? "Draft updated" : "Draft saved");
      onSaved();
    } catch (e) {
      toast.error("Could not save the draft", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? (draft ? `Edit draft #${draft.id}` : "New draft")}</DialogTitle>
          <DialogDescription>Saved server-side and audited. Prices are what you agreed with the customer; nothing is checked against stock or the store until the write path is enabled.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="d-store">Store</Label>
              <Select value={store} onValueChange={setStore} disabled={draft !== null}>
                <SelectTrigger id="d-store"><SelectValue placeholder="Pick a store" /></SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{storeLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Payment</Label>
              <ToggleGroup type="single" value={payment} onValueChange={(v) => v && setPayment(v as OrderDraft["payment_method"])} variant="outline" size="sm">
                <ToggleGroupItem value="cod">COD</ToggleGroupItem>
                <ToggleGroupItem value="online">Online</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="d-name">Name</Label><Input id="d-name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="d-phone">Phone</Label><Input id="d-phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="d-email">E-mail</Label><Input id="d-email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-3 grid gap-1.5"><Label htmlFor="d-a1">Address</Label><Input id="d-a1" value={shipping.address_1} onChange={(e) => setShipping({ ...shipping, address_1: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="d-pc">Postcode</Label><Input id="d-pc" value={shipping.postcode} onChange={(e) => setShipping({ ...shipping, postcode: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="d-city">City</Label><Input id="d-city" value={shipping.city} onChange={(e) => setShipping({ ...shipping, city: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="d-state">State</Label><Input id="d-state" value={shipping.state} onChange={(e) => setShipping({ ...shipping, state: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label>Items</Label>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_70px_100px_32px] items-center gap-2">
                <Input placeholder="SKU" value={it.sku ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} aria-label="SKU" />
                <Input placeholder="Name" value={it.name ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Item name" />
                <Input type="number" min={1} value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="Quantity" className="tnum" />
                <Input type="number" min={0} step="0.01" value={it.unit_price} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))} aria-label="Unit price" className="tnum" />
                <Button size="icon" variant="ghost" className="size-8" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setItems([...items, EMPTY_ITEM])}>
                <Plus className="size-3" aria-hidden /> Add item
              </Button>
              <Badge variant="outline" className="tnum font-normal">Total {money(ccy, draftTotal(items))}</Badge>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-note">Note</Label>
            <Textarea id="d-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Conversation reference, agreed price, anything the reviewer needs." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !valid}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} {draft ? "Save changes" : "Save draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
