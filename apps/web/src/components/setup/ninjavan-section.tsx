"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Radio, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useLiveQuery } from "@/hooks/use-live-query";
import { usePermission } from "@/hooks/use-session";
import { fetchNvConnection, fetchNvCounts, saveNvConnection } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://<project>.supabase.co"}/functions/v1/nv-webhook`;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1.5">
        <Input readOnly value={value} className="tnum h-8 text-xs" onFocus={(e) => e.target.select()} />
        <Button
          type="button" variant="outline" size="icon" className="size-8 shrink-0"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Ninja Van read-side: the tracking webhook (HMAC-verified with the API
 * client key) and the API client credentials in Vault. Storing credentials
 * changes nothing about booking — consignments stay in shadow until the
 * ADR-0006 exit gate passes and a store is flipped by set_fulfilment_mode.
 */
export function NinjaVanSection() {
  const canConnect = usePermission("integrations.connect");
  const [configOpen, setConfigOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, error, loading, reload } = useLiveQuery(async () => {
    const [connection, counts] = await Promise.all([fetchNvConnection(), fetchNvCounts()]);
    return { connection, counts };
  }, []);

  const connection = data?.connection ?? null;
  const counts = data?.counts ?? { shipments: 0, events_24h: 0, last_event_at: null };
  const receiving = Boolean(connection?.last_success_at);
  const configured = connection !== null && connection.status !== "pending_setup";

  async function handleSave() {
    setSaving(true);
    try {
      await saveNvConnection(clientId.trim(), clientKey.trim());
      toast.success("Ninja Van credentials stored", {
        description: "Kept encrypted in Vault. Register the webhook URL in the Shipper Dashboard if you have not yet.",
      });
      setConfigOpen(false);
      setClientId("");
      setClientKey("");
      await reload();
    } catch (e) {
      toast.error("Could not store credentials", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Truck className="size-4 text-info" aria-hidden />
            Ninja Van — tracking webhook and API client
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tracking events arrive by webhook and roll up per parcel. Booking stays in shadow mode (ADR-0006):
            storing credentials here never creates a consignment.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 text-[10px]",
            !loading && receiving ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground",
          )}
        >
          <Radio className="size-3" aria-hidden />
          {loading ? "checking…" : receiving ? "receiving" : configured ? "no events yet" : "not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-3 gap-3" role="status" aria-label="Loading Ninja Van status">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-md border px-3 py-2">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="mt-1 h-6 w-12" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState title="Could not load Ninja Van status" description={error} retry={() => void reload()} />
        ) : !connection ? (
          <p className="text-sm text-muted-foreground">No Ninja Van row exists in the connection register.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Parcels tracked", value: counts.shipments.toLocaleString() },
                { label: "Events last 24h", value: counts.events_24h.toLocaleString() },
              ].map((m) => (
                <div key={m.label} className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{m.label}</div>
                  <div className="tnum mt-0.5 text-base font-semibold">{m.value}</div>
                </div>
              ))}
              <div className="rounded-md border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Last webhook</div>
                <div className="mt-1">
                  {connection.last_success_at ? (
                    <FreshnessBadge lastSuccessAt={connection.last_success_at} slaMinutes={60} realClock />
                  ) : (
                    <span className="text-xs text-muted-foreground">none received</span>
                  )}
                </div>
              </div>
            </div>

            {connection.notes && <p className="text-xs text-muted-foreground">{connection.notes}</p>}

            <CopyField label="Webhook URL (Shipper Dashboard → Webhooks)" value={WEBHOOK_URL} />

            <div className="flex flex-wrap items-center gap-2">
              {canConnect ? (
                <Button size="sm" onClick={() => setConfigOpen(true)}>
                  {configured ? "Rotate credentials" : "Configure connection"}
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled title="HQ admin only">
                  Configure — HQ admin only
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Needs the API Client ID + Client Key from the Ninja Van Shipper Dashboard. The key also verifies
                webhook signatures. Stored encrypted in Vault — write-only from the browser.
              </p>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{configured ? "Rotate Ninja Van credentials" : "Configure Ninja Van"}</DialogTitle>
            <DialogDescription>
              Both values are written straight to Vault by an HQ-admin-only function and never echoed back.
              Rotating replaces the previous pair; the webhook keeps verifying against the new key.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="nv-client-id" className="text-xs">API Client ID</Label>
              <Input id="nv-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" className="tnum h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nv-client-key" className="text-xs">API Client Key</Label>
              <Input id="nv-client-key" type="password" value={clientKey} onChange={(e) => setClientKey(e.target.value)} autoComplete="off" className="tnum h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving || clientId.trim().length < 16 || clientKey.trim().length < 16}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Store in Vault
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
