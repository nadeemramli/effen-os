"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Radio, Workflow } from "lucide-react";
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
import { fetchAirbyteConnection, fetchPipelineRuns, saveAirbyteConnection } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

const WEBHOOK_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://<project>.supabase.co"}/functions/v1/pipeline-webhook`;

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1.5">
        <Input readOnly type={secret ? "password" : "text"} value={value} className="tnum h-8 text-xs" onFocus={(e) => e.target.select()} />
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
 * Airbyte Cloud observability: the notification webhook (token in the URL,
 * issued once here and stored in Vault) and an optional API application for
 * the 30-minute poller. Read-only towards Airbyte — nothing here triggers,
 * cancels or reconfigures a sync; schedules stay in infra/prod/airbyte.tf.
 */
export function AirbyteSection() {
  const canConnect = usePermission("integrations.connect");
  const [configOpen, setConfigOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [saving, setSaving] = useState(false);
  // The webhook token is shown once, right after it is issued (write-only otherwise).
  const [issued, setIssued] = useState<string | null>(null);

  const { data, error, loading, reload } = useLiveQuery(async () => {
    const [connection, pipeline] = await Promise.all([fetchAirbyteConnection(), fetchPipelineRuns(48, 1)]);
    return { connection, summary: pipeline.summary };
  }, []);

  const connection = data?.connection ?? null;
  const summary = data?.summary ?? null;
  const receiving = Boolean(connection?.last_success_at);
  const pollerConfigured = Boolean(connection?.config?.workspace_id);

  async function handleSave(withClient: boolean) {
    setSaving(true);
    try {
      const token = await saveAirbyteConnection(
        withClient ? { clientId: clientId.trim(), clientSecret: clientSecret.trim(), workspaceId: workspaceId.trim() || null } : { workspaceId: workspaceId.trim() || null },
      );
      setIssued(token);
      toast.success(withClient ? "Airbyte API client stored in Vault" : "Webhook token issued", {
        description: "Copy the webhook URL below into Airbyte Cloud → Settings → Notifications.",
      });
      setConfigOpen(false);
      setClientId("");
      setClientSecret("");
      await reload();
    } catch (e) {
      toast.error("Could not store the Airbyte configuration", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Workflow className="size-4 text-info" aria-hidden />
            Airbyte Cloud — pipeline notifications and poller
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every sync outcome lands in Fullkit&apos;s pipeline ledger the moment Airbyte reports it; the poller
            back-fills from the public API every 30 minutes. Schedules stay in Terraform.
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
          {loading ? "checking…" : receiving ? "receiving" : "not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-3 gap-3" role="status" aria-label="Loading Airbyte status">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-md border px-3 py-2">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="mt-1 h-6 w-12" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState title="Could not load Airbyte status" description={error} retry={() => void reload()} />
        ) : !connection ? (
          <p className="text-sm text-muted-foreground">No Airbyte row exists in the connection register.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Connections expected</div>
                <div className="tnum mt-0.5 text-base font-semibold">{summary?.airbyte.expected ?? "—"}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Succeeded, last 26h</div>
                <div className={cn("tnum mt-0.5 text-base font-semibold", summary && summary.airbyte.stale > 0 && summary.airbyte.observed > 0 && "text-warning")}>
                  {summary ? `${summary.airbyte.succeeded_26h}/${summary.airbyte.expected}` : "—"}
                </div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Last notification</div>
                <div className="mt-1">
                  {connection.last_success_at ? (
                    <FreshnessBadge lastSuccessAt={connection.last_success_at} slaMinutes={connection.freshness_sla_minutes} realClock />
                  ) : (
                    <span className="text-xs text-muted-foreground">none received</span>
                  )}
                </div>
              </div>
            </div>

            {connection.notes && <p className="text-xs text-muted-foreground">{connection.notes}</p>}

            {issued ? (
              <div className="space-y-2 rounded-md border border-info/25 bg-info/10 p-3">
                <p className="text-xs text-info">
                  Token issued — it is shown only now. Paste the URL into every webhook row of Airbyte Cloud → Settings →
                  Notifications and press Test; add the token as the GitHub secret <code>FULLKIT_PIPELINE_TOKEN</code>
                  (and <code>FULLKIT_PIPELINE_WEBHOOK_URL</code> = the base URL) for the dbt report step.
                </p>
                <CopyField label="Webhook URL for Airbyte (with token)" value={`${WEBHOOK_BASE}?token=${issued}`} />
                <CopyField label="Base URL for GitHub (FULLKIT_PIPELINE_WEBHOOK_URL)" value={WEBHOOK_BASE} />
                <CopyField label="Token for GitHub (FULLKIT_PIPELINE_TOKEN)" value={issued} secret />
              </div>
            ) : (
              <CopyField label="Webhook base URL (token is appended when issued below)" value={WEBHOOK_BASE} />
            )}

            <div className="flex flex-wrap items-center gap-2">
              {canConnect ? (
                <>
                  <Button size="sm" variant={issued ? "outline" : "default"} disabled={saving} onClick={() => void handleSave(false)}>
                    {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {connection.status === "pending_setup" && !receiving ? "Issue webhook token" : "Show webhook URL again"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
                    {pollerConfigured ? "Rotate API client" : "Configure API poller"}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled title="HQ admin only">
                  Configure — HQ admin only
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Webhook token and API client secret are stored encrypted in Vault — write-only from the browser.
                {pollerConfigured ? " Poller configured." : " Poller idle until an API application is stored."}
              </p>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pollerConfigured ? "Rotate the Airbyte API client" : "Configure the Airbyte API poller"}</DialogTitle>
            <DialogDescription>
              Create an application in Airbyte Cloud → Settings → Applications and paste its client id and secret; the
              workspace id is in the Airbyte URL. The poller only reads connections and job history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ab-ws" className="text-xs">Workspace ID</Label>
              <Input id="ab-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} autoComplete="off" className="tnum h-8 text-xs" placeholder={connection?.config?.workspace_id ? String(connection.config.workspace_id) : "00000000-0000-0000-0000-000000000000"} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ab-id" className="text-xs">Client ID</Label>
              <Input id="ab-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" className="tnum h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ab-secret" className="text-xs">Client Secret</Label>
              <Input id="ab-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" className="tnum h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void handleSave(true)} disabled={saving || clientId.trim().length < 16 || clientSecret.trim().length < 16}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Store in Vault
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
