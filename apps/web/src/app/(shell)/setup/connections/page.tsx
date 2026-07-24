"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, RefreshCcw, Store } from "lucide-react";
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
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import {
  fetchOrdersReadCount,
  fetchRecentRuns,
  fetchWooConnections,
  saveWooConnection,
  triggerSync,
  type LiveSyncRun,
  type LiveWooConnection,
} from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  healthy: "border-success/30 bg-success/10 text-success",
  degraded: "border-warning/30 bg-warning/10 text-warning",
  stale: "border-destructive/30 bg-destructive/10 text-destructive",
  pending_setup: "text-muted-foreground",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
}

function ConnectionsInner() {
  const [connections, setConnections] = useState<LiveWooConnection[]>([]);
  const [runs, setRuns] = useState<LiveSyncRun[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LiveWooConnection | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [ck, setCk] = useState("");
  const [cs, setCs] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<number | "all" | null>(null);

  const reload = useCallback(async () => {
    try {
      const conns = await fetchWooConnections();
      setConnections(conns);
      const [runRows, ...countRows] = await Promise.all([
        fetchRecentRuns(conns.map((c) => c.id)),
        ...conns.map((c) => fetchOrdersReadCount(c.id)),
      ]);
      setRuns(runRows);
      setCounts(Object.fromEntries(conns.map((c, i) => [c.id, countRows[i] ?? 0])));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: every setState in reload() happens after an await,
    // so nothing is set synchronously within the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await saveWooConnection({ connectionId: editing.id, baseUrl: baseUrl.trim(), consumerKey: ck.trim(), consumerSecret: cs.trim() });
      toast.success("Store connected", { description: "Key stored encrypted in Vault. Run a sync to start the backfill." });
      setEditing(null);
      setCk("");
      setCs("");
      await reload();
    } catch (e) {
      toast.error("Could not save connection", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSync(connectionId?: number) {
    setSyncing(connectionId ?? "all");
    try {
      const result = (await triggerSync(connectionId)) as { results?: Record<string, unknown>[] };
      const summary = (result.results ?? [])
        .map((r) => `${r.connection}: ${r.success ? `${r.written} orders` : r.skipped ?? r.failed}`)
        .join(" · ");
      toast.info("Sync finished", { description: summary || "No connections attempted." });
      await reload();
    } catch (e) {
      toast.error("Sync failed to start", { description: (e as Error).message });
    } finally {
      setSyncing(null);
    }
  }

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Store connections"
        description="Live WooCommerce read-side — one connection, one read-only key pair, and one checkpoint per brand site."
      >
        <div className="flex items-center gap-2">
          <Link href="/setup/brands" className="text-sm text-info underline-offset-2 hover:underline">
            Brands & catalog
          </Link>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={syncing !== null} onClick={() => handleSync()}>
            {syncing === "all" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCcw className="size-3.5" aria-hidden />}
            Sync all now
          </Button>
        </div>
      </PageHeader>

      <p className="rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
        Keys are created per site in WP Admin → WooCommerce → Settings → Advanced → REST API, with{" "}
        <span className="font-medium">Read</span> permission only. Pasted keys are stored encrypted in
        Supabase Vault; they can be written from here but never read back by any browser. The first sync
        backfills the full order history (auto-continues every 15 minutes; “Sync now” pulls up to 3,000
        orders per click).
      </p>

      {loadError && (
        <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Failed to load connections: {loadError}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {connections.map((c) => {
            const connRuns = runs.filter((r) => r.integration_id === c.id).slice(0, 3);
            const configured = Boolean(c.config?.base_url);
            return (
              <Card key={c.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Store className="size-4 text-muted-foreground" aria-hidden />
                      {c.name}
                    </CardTitle>
                    <p className="tnum mt-0.5 text-xs text-muted-foreground">
                      {c.config?.base_url ?? "no store URL yet"} · {counts[c.id] ?? 0} orders mirrored
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[c.status])}>
                    {c.status.replace("_", " ")}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Last success</dt><dd className="tnum">{fmtTime(c.last_success_at)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Checkpoint</dt><dd className="tnum truncate pl-2">{c.sync_checkpoint ?? "—"}</dd></div>
                  </dl>
                  {connRuns.length > 0 && (
                    <ul className="space-y-1 border-t pt-2 text-[11px]">
                      {connRuns.map((r) => (
                        <li key={r.id} className="flex items-center gap-2">
                          <span className={cn("font-medium capitalize", r.status === "success" ? "text-success" : r.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                            {r.status}
                          </span>
                          <span className="tnum text-muted-foreground">{fmtTime(r.started_at)}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {r.reason_code ? `${r.reason_code} — ` : ""}{r.message ?? `${r.records_written} written`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline" className="flex-1 gap-1.5"
                      onClick={() => {
                        setEditing(c);
                        setBaseUrl(c.config?.base_url ?? "https://");
                      }}
                    >
                      <KeyRound className="size-3.5" aria-hidden />
                      {configured ? "Update store / rotate key" : "Connect store"}
                    </Button>
                    <Button
                      size="sm" className="flex-1 gap-1.5"
                      disabled={!configured || syncing !== null}
                      onClick={() => handleSync(c.id)}
                    >
                      {syncing === c.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCcw className="size-3.5" aria-hidden />}
                      Sync now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
            <DialogDescription>
              Paste the store URL and a read-only REST key from this brand&apos;s own site. Saving stores the
              key encrypted in Vault and is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wc-url">Store URL (https)</Label>
              <Input id="wc-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourstore.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wc-ck">Consumer key</Label>
              <Input id="wc-ck" value={ck} onChange={(e) => setCk(e.target.value)} placeholder="ck_…" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wc-cs">Consumer secret</Label>
              <Input id="wc-cs" type="password" value={cs} onChange={(e) => setCs(e.target.value)} placeholder="cs_…" autoComplete="off" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Permissions must be <span className="font-medium">Read</span> — Fullkit never writes to the store.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={saving || !baseUrl.startsWith("https://") || !ck.startsWith("ck_") || !cs.startsWith("cs_")} onClick={handleSave} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              Save connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

export default function ConnectionsSetupPage() {
  return (
    <LiveGuard>
      <ConnectionsInner />
    </LiveGuard>
  );
}
