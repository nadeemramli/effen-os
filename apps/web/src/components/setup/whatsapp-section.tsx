"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, MessageSquareText, Radio } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchLiveBrands,
  fetchWaConnection,
  fetchWaCounts,
  fetchWaNumbers,
  mapWaNumber,
  saveWaConnection,
  type LiveBrand,
  type LiveWaConnection,
  type LiveWaNumber,
} from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://<project>.supabase.co"}/functions/v1/wa-webhook`;

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

export function WhatsAppSection() {
  const [connection, setConnection] = useState<LiveWaConnection | null>(null);
  const [numbers, setNumbers] = useState<LiveWaNumber[]>([]);
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [counts, setCounts] = useState({ conversations: 0, messages: 0 });
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [appSecret, setAppSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [conn, nums, b, c] = await Promise.all([
        fetchWaConnection(),
        fetchWaNumbers(),
        fetchLiveBrands(),
        fetchWaCounts(),
      ]);
      setConnection(conn);
      setNumbers(nums);
      setBrands(b.filter((x) => x.status === "active"));
      setCounts(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount; every setState happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const receiving = Boolean(connection?.last_success_at);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <MessageSquareText className="size-4 text-success" aria-hidden />
            WhatsApp Cloud API — all brands, one webhook
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Meta pushes messages here the moment the webhook connects. No history backfill exists —
            every unconnected day is lost conversation history.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 text-[10px]",
            receiving ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground",
          )}
        >
          <Radio className="size-3" aria-hidden />
          {receiving ? "receiving" : "not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /></div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Registered numbers", value: String(numbers.length) },
                { label: "Conversations captured", value: counts.conversations.toLocaleString() },
                { label: "Messages captured", value: counts.messages.toLocaleString() },
              ].map((m) => (
                <div key={m.label} className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{m.label}</div>
                  <div className="tnum mt-0.5 text-base font-semibold">{m.value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setConfigOpen(true)}>
                {receiving || connection?.status !== "pending_setup" ? "Rotate credentials" : "Configure connection"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Needs the Meta App Secret + a System User token (Business Settings → System Users). Stored
                encrypted in Vault — write-only from the browser.
              </p>
            </div>

            {numbers.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Numbers → brand mapping (numbers auto-register on their first webhook)
                </div>
                <ul className="space-y-1.5">
                  {numbers.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 text-sm">
                      <span className="tnum">{n.display_number ?? n.phone_number_id}</span>
                      {!n.brand_id && (
                        <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">unmapped</Badge>
                      )}
                      <Select
                        value={n.brand_id ? String(n.brand_id) : ""}
                        onValueChange={async (v) => {
                          try {
                            await mapWaNumber(n.id, Number(v));
                            toast.success("Number mapped");
                            await reload();
                          } catch (e) {
                            toast.error("Mapping failed", { description: (e as Error).message });
                          }
                        }}
                      >
                        <SelectTrigger className="ml-auto h-7 w-44 text-xs" aria-label={`Brand for ${n.phone_number_id}`}>
                          <SelectValue placeholder="Map to brand…" />
                        </SelectTrigger>
                        <SelectContent>
                          {brands.map((b) => (
                            <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={configOpen} onOpenChange={(o) => { setConfigOpen(o); if (!o) { setAppSecret(""); setAccessToken(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure WhatsApp Cloud API</DialogTitle>
            <DialogDescription>
              From your Meta App: App Settings → Basic for the App Secret; Business Settings → System
              Users for a permanent token with whatsapp_business_messaging + management.
            </DialogDescription>
          </DialogHeader>
          {verifyToken ? (
            <div className="space-y-3">
              <p className="rounded-md border border-success/25 bg-success/10 px-3 py-2 text-xs text-success">
                Secrets stored. Now in the Meta App dashboard (WhatsApp → Configuration), paste these two
                values and subscribe to <span className="font-mono">messages</span> (+ statuses, message
                echoes, and history if shown):
              </p>
              <CopyField label="Callback URL" value={WEBHOOK_URL} />
              <CopyField label="Verify token" value={verifyToken} />
              <p className="text-[11px] text-muted-foreground">
                When Meta verifies the webhook and the first event arrives, the badge above flips to
                “receiving” and numbers appear for brand mapping.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wa-secret">App Secret</Label>
                <Input id="wa-secret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-token">System User access token</Label>
                <Input id="wa-token" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} autoComplete="off" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>{verifyToken ? "Done" : "Cancel"}</Button>
            {!verifyToken && (
              <Button
                disabled={saving || appSecret.length < 16 || accessToken.length < 16}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const token = await saveWaConnection(appSecret.trim(), accessToken.trim());
                    setVerifyToken(token);
                    await reload();
                  } catch (e) {
                    toast.error("Could not store credentials", { description: (e as Error).message });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Store & get verify token
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
