"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
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
import { fetchAiConnection, setAiConnection, type LiveAiConnection } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

/**
 * OpenRouter — address AI (suggest-only, ADR-0006). The key is written to
 * Vault via set_ai_connection and never readable from the browser. Runs on
 * flagged pilot-store orders after each sync; every proposal waits for a
 * human in the fix-shipping dialog.
 */
export function AiSection() {
  const [connection, setConnection] = useState<LiveAiConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setConnection(await fetchAiConnection());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount; every setState happens after an await.
    void reload();
  }, [reload]);

  const active = connection?.status === "healthy";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-info" aria-hidden />
            OpenRouter — AI address suggestions
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drafts corrections for flagged shipping details after each sync. Strictly suggest-only —
            an operator reviews and records every fix; nothing is applied automatically.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            active ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground",
          )}
        >
          {active ? "suggesting" : connection ? connection.status.replace("_", " ") : "—"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /></div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Model</dt>
                <dd className="tnum">{connection?.config?.model ?? "—"}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Scope</dt>
                <dd>{connection?.config?.ai_scope === "all" ? "all stores" : "pilot stores"}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Caps</dt>
                <dd className="tnum">{connection?.config?.batch_cap ?? 20}/run · {connection?.config?.daily_cap ?? 400}/day</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Last run</dt>
                <dd className="tnum">
                  {connection?.last_success_at
                    ? new Date(connection.last_success_at).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" })
                    : "never"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setConfigOpen(true)}>
                {active ? "Rotate API key" : "Configure API key"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Key stored encrypted in Vault — write-only from the browser. Customer name, phone and
                address of flagged orders are sent to the model with provider data-collection off.
              </p>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={configOpen} onOpenChange={(o) => { setConfigOpen(o); if (!o) setApiKey(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure OpenRouter</DialogTitle>
            <DialogDescription>
              Create a key at openrouter.ai → Keys. Suggestions start on the next address-suggest run
              (every 15 minutes) once the key is stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="or-key">API key</Label>
            <Input
              id="or-key" type="password" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-…" autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Cancel</Button>
            <Button
              disabled={saving || apiKey.trim().length < 20}
              className="gap-1.5"
              onClick={async () => {
                setSaving(true);
                try {
                  await setAiConnection(apiKey.trim());
                  toast.success("OpenRouter key stored", { description: "Encrypted in Vault and audited. Suggestions start on the next run." });
                  setConfigOpen(false);
                  setApiKey("");
                  await reload();
                } catch (e) {
                  toast.error("Could not store the key", { description: (e as Error).message });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              Store key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
