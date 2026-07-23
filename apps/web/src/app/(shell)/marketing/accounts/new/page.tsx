"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useRepo } from "@/hooks/use-repo";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

type Platform = "meta" | "google" | "tiktok";

const PLATFORM_META: Record<Platform, { label: string; oauthHost: string; accounts: { id: string; name: string; currency: "MYR" | "SGD" }[]; readScopes: { key: string; label: string }[]; writeScopes: { key: string; label: string }[]; objects: string[] }> = {
  meta: {
    label: "Meta",
    oauthHost: "facebook.com (simulated)",
    accounts: [
      { id: "act_238000004", name: "EFFEN — Solstice SG", currency: "SGD" },
      { id: "act_238000005", name: "EFFEN — Nara Coffee", currency: "MYR" },
    ],
    readScopes: [
      { key: "ads_read", label: "ads_read — campaigns, ad sets, ads" },
      { key: "insights.read", label: "insights — spend, results, breakdowns" },
    ],
    writeScopes: [
      { key: "ads_management", label: "ads_management — edit budgets & status" },
    ],
    objects: ["Campaigns", "Ad sets", "Ads", "Creatives", "Daily insights (90 days back)"],
  },
  google: {
    label: "Google",
    oauthHost: "accounts.google.com (simulated)",
    accounts: [
      { id: "512-330-0002", name: "EFFEN — Solstice SG Search", currency: "SGD" },
    ],
    readScopes: [{ key: "adwords.readonly", label: "adwords.readonly — reporting" }],
    writeScopes: [{ key: "adwords", label: "adwords — full management" }],
    objects: ["Campaigns", "Ad groups", "Keywords", "Daily reports (90 days back)"],
  },
  tiktok: {
    label: "TikTok",
    oauthHost: "business.tiktok.com (simulated)",
    accounts: [
      { id: "TT-ADV-900002", name: "EFFEN — Lipidri TikTok", currency: "MYR" },
    ],
    readScopes: [
      { key: "ads.read", label: "ads.read — campaign reporting" },
      { key: "shop.orders.read", label: "shop.orders.read — TikTok Shop orders" },
    ],
    writeScopes: [{ key: "ads.manage", label: "ads.manage — edit campaigns" }],
    objects: ["Campaigns", "Ad groups", "Ads", "Shop orders", "Daily reports (90 days back)"],
  },
};

const STEPS = ["Platform", "Authenticate", "Accounts", "Mapping", "Scopes", "Review", "Sync"] as const;

function ConnectAccountInner() {
  const repo = useRepo();
  const brands = useAppStore((s) => s.brands);
  const legalEntities = useAppStore((s) => s.legalEntities);
  const personas = useAppStore((s) => s.personas);

  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform>("meta");
  const [authing, setAuthing] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState("BRD-solstice");
  const [legalEntityId, setLegalEntityId] = useState("LE-sg");
  const [purpose, setPurpose] = useState("");
  const [ownerId, setOwnerId] = useState("USR-farah");
  const [scopes, setScopes] = useState<string[]>(
    PLATFORM_META.meta.readScopes.map((s) => s.key),
  );
  const [testState, setTestState] = useState<"idle" | "testing" | "ok">("idle");
  const [syncPct, setSyncPct] = useState(0);
  const finalizedRef = useRef(false);

  const meta = PLATFORM_META[platform];
  const account = meta.accounts.find((a) => a.id === accountId) ?? null;
  const brand = brands.find((b) => b.id === brandId);

  function choosePlatform(p: Platform) {
    setPlatform(p);
    setScopes(PLATFORM_META[p].readScopes.map((s) => s.key));
    setAccountId(null);
    setAuthed(false);
  }

  /** Runs from the "Start initial sync" click — no effects involved. */
  function startInitialSync() {
    setStep(6);
    setSyncPct(0);
    const iv = setInterval(() => {
      setSyncPct((p) => {
        const next = Math.min(p + 10, 100);
        if (next >= 100) {
          clearInterval(iv);
          finalizeConnection();
        }
        return next;
      });
    }, 220);
  }

  function finalizeConnection() {
    if (!account || !brand || finalizedRef.current) return;
    finalizedRef.current = true;
    void repo.connectAdAccount({
      platform,
      accountName: account.name,
      externalId: account.id,
      brandId,
      legalEntityId,
      market: brand.markets[0] ?? "MY",
      currency: account.currency,
      purpose: purpose || "Read-side reporting",
      ownerId,
      scopes,
    });
    toast.success("Account connected", { description: `${account.name} now appears in Integrations.` });
  }

  const canContinue = useMemo(() => {
    switch (step) {
      case 0: return true;
      case 1: return authed;
      case 2: return accountId !== null;
      case 3: return purpose.trim().length > 0;
      case 4: return scopes.length > 0;
      case 5: return testState === "ok";
      default: return false;
    }
  }, [step, authed, accountId, purpose, scopes, testState]);

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="Connect ad account"
        description="Read-only by default. No credential or token is ever displayed in Fullkit."
      >
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Link href="/marketing"><ArrowLeft className="size-3.5" aria-hidden /> Marketing</Link>
        </Button>
      </PageHeader>

      {/* stepper */}
      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Wizard steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn(
              "flex size-5 items-center justify-center rounded-full text-[10px] font-medium",
              i < step ? "bg-success text-success-foreground" : i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}>
              {i + 1}
            </span>
            <span className={cn(i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-0.5 h-px w-4 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="pt-6">
          {/* step 0: platform */}
          {step === 0 && (
            <RadioGroup value={platform} onValueChange={(v) => choosePlatform(v as Platform)} className="gap-2">
              {(Object.keys(PLATFORM_META) as Platform[]).map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-ring">
                  <RadioGroupItem value={p} id={`plat-${p}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{PLATFORM_META[p].label} Ads</span>
                    <span className="text-xs text-muted-foreground">OAuth via {PLATFORM_META[p].oauthHost}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}

          {/* step 1: simulated oauth */}
          {step === 1 && (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="w-full max-w-sm rounded-lg border bg-muted/40 p-5">
                <div className="text-xs text-muted-foreground">{meta.oauthHost}</div>
                <div className="mt-3 text-sm font-medium">
                  Fullkit wants to access your {meta.label} Ads data
                </div>
                <ul className="mx-auto mt-2 max-w-64 space-y-1 text-left text-xs text-muted-foreground">
                  {meta.readScopes.map((s) => (
                    <li key={s.key} className="flex items-start gap-1.5">
                      <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success" aria-hidden />
                      {s.label}
                    </li>
                  ))}
                </ul>
                {!authed ? (
                  <Button
                    className="mt-4 w-full"
                    disabled={authing}
                    onClick={() => {
                      setAuthing(true);
                      setTimeout(() => {
                        setAuthing(false);
                        setAuthed(true);
                        toast.success("Authenticated (simulated)");
                      }, 900);
                    }}
                  >
                    {authing && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {authing ? "Redirecting…" : "Continue as EFFEN Demo User"}
                  </Button>
                ) : (
                  <div className="mt-4 flex items-center justify-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> Authenticated
                  </div>
                )}
              </div>
              <p className="mt-3 max-w-sm text-[11px] text-muted-foreground">
                Simulated consent screen. In production, OAuth happens server-side and tokens are stored in a
                secrets manager — never in the browser.
              </p>
            </div>
          )}

          {/* step 2: accounts */}
          {step === 2 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Accounts this login can access:</p>
              <RadioGroup value={accountId ?? ""} onValueChange={setAccountId} className="gap-2">
                {meta.accounts.map((a) => (
                  <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-ring">
                    <RadioGroupItem value={a.id} id={a.id} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{a.name}</span>
                      <span className="tnum text-xs text-muted-foreground">{a.id} · {a.currency}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* step 3: mapping */}
          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Legal entity</Label>
                <Select value={legalEntityId} onValueChange={setLegalEntityId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {legalEntities.map((le) => (
                      <SelectItem key={le.id} value={le.id}>{le.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Market / currency</Label>
                <Input disabled value={`${brand?.markets[0] ?? "MY"} · ${account?.currency ?? ""} (from account)`} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {personas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="purpose">Business purpose</Label>
                <Input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Always-on prospecting for Solstice SG" />
                <p className="text-[11px] text-muted-foreground">Recorded on the connection so spend is attributable to a stated purpose.</p>
              </div>
            </div>
          )}

          {/* step 4: scopes */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Read scopes</div>
                <div className="space-y-2">
                  {meta.readScopes.map((s) => (
                    <label key={s.key} className="flex items-center gap-2.5 text-sm">
                      <Checkbox
                        checked={scopes.includes(s.key)}
                        onCheckedChange={(c) =>
                          setScopes((prev) => (c ? [...prev, s.key] : prev.filter((x) => x !== s.key)))
                        }
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Write scopes</div>
                <div className="space-y-2">
                  {meta.writeScopes.map((s) => (
                    <div key={s.key} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <Checkbox disabled checked={false} />
                      <span className="flex-1">{s.label}</span>
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Lock className="size-3" aria-hidden /> requires separate approval
                      </Badge>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Write access (budgets, status changes) is a separate governed request with HQ approval and its own audit trail.
                </p>
              </div>
            </div>
          )}

          {/* step 5: review + test */}
          {step === 5 && (
            <div className="space-y-3">
              <dl className="space-y-1.5 rounded-md border p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Platform</dt><dd>{meta.label} Ads</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Account</dt><dd className="tnum">{account?.name} ({account?.id})</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Mapped to</dt><dd>{brand?.name} · {legalEntities.find((l) => l.id === legalEntityId)?.name}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Owner</dt><dd>{personas.find((p) => p.id === ownerId)?.name}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Scopes</dt><dd className="text-right">{scopes.join(", ")} <span className="text-muted-foreground">(read-only)</span></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Data range</dt><dd>90 days back, then incremental daily</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Objects</dt><dd className="max-w-60 text-right">{meta.objects.join(", ")}</dd></div>
              </dl>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={testState === "testing" || testState === "ok"}
                  onClick={() => {
                    setTestState("testing");
                    setTimeout(() => setTestState("ok"), 1100);
                  }}
                >
                  {testState === "testing" && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {testState === "ok" ? "Connection OK" : testState === "testing" ? "Testing…" : "Test connection"}
                </Button>
                {testState === "ok" && (
                  <span className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> Read access verified · 2 campaigns visible
                  </span>
                )}
              </div>
            </div>
          )}

          {/* step 6: sync */}
          {step === 6 && (
            <div className="flex flex-col items-center py-6 text-center">
              {syncPct < 100 ? (
                <>
                  <Loader2 className="mb-3 size-6 animate-spin text-info" aria-hidden />
                  <div className="text-sm font-medium">Initial sync running…</div>
                  <p className="mt-1 text-xs text-muted-foreground">Backfilling 90 days of campaign structure and daily insights.</p>
                </>
              ) : (
                <>
                  <CheckCircle2 className="mb-3 size-8 text-success" aria-hidden />
                  <div className="text-sm font-medium">Connected and synced</div>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    {account?.name} is mapped to {brand?.name} and now appears in Integrations and the Marketing
                    account coverage strip. First incremental sync in ~4 hours.
                  </p>
                </>
              )}
              <div className="mt-4 w-full max-w-xs">
                <Progress value={syncPct} aria-label="Initial sync progress" />
                <div className="tnum mt-1 text-xs text-muted-foreground">{syncPct}%</div>
              </div>
              {syncPct >= 100 && (
                <div className="mt-5 flex gap-2">
                  <Button asChild><Link href="/integrations">View in Integrations</Link></Button>
                  <Button asChild variant="outline"><Link href="/marketing">Back to Marketing</Link></Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {step < 6 && (
        <div className="flex justify-between">
          <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="gap-1.5">
            <ArrowLeft className="size-3.5" aria-hidden /> Back
          </Button>
          <Button
            size="sm"
            disabled={!canContinue}
            onClick={() => (step === 5 ? startInitialSync() : setStep((s) => s + 1))}
            className="gap-1.5"
          >
            {step === 5 ? "Start initial sync" : "Continue"} <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </PageBody>
  );
}

export default function ConnectAccountPage() {
  return (
    <RouteGuard permission="integrations.connect">
      <ConnectAccountInner />
    </RouteGuard>
  );
}
