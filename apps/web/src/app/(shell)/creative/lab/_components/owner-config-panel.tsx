"use client";

import { useState } from "react";
import { KeyRound, Save } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, SkeletonCards } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useSession } from "@/hooks/use-session";
import { MISSING_CONFIG_LABELS } from "@/lib/creative-lab/readiness";
import type { BrandReadinessRow, MissingConfigKey } from "@/lib/creative-lab/types";
import {
  fetchProviderStatus,
  fetchRuntimeConfig,
  setProviderKey,
  setRuntimeConfig,
  type RuntimeConfig,
} from "@/lib/supabase/creative-lab";
import { fetchWorkspaceMembers } from "@/lib/supabase/live";
import { Pill } from "./lab-banners";

const NUMERIC = [
  "batch_budget_amount",
  "max_cost_per_candidate",
  "target_cpa",
  "target_roas",
  "media_test_budget_amount",
] as const;
const PRICING_NUMERIC = [
  "image_estimate_per_call",
  "analysis_estimate_per_call",
  "text_input_per_mtok",
  "text_output_per_mtok",
  "image_input_per_mtok",
  "image_output_per_mtok",
] as const;

type Form = Record<string, string> & { reviewers: string; approved: string };

function toForm(c: RuntimeConfig): Form {
  const f: Form = {
    image_provider: c.image_provider ?? "openai",
    image_model: c.image_model ?? "",
    analysis_provider: c.analysis_provider ?? "openai",
    analysis_model: c.analysis_model ?? "",
    budget_currency: c.budget_currency ?? "",
    economics_currency: c.economics_currency ?? "",
    reviewers: (c.reviewer_membership_ids ?? []).join(","),
    approved: c.provider_data_approved ? "1" : "",
    pricing_currency: String(c.provider_pricing?.currency ?? ""),
    pricing_source: String(c.provider_pricing?.source ?? ""),
    pricing_as_of: String(c.provider_pricing?.as_of ?? ""),
  };
  for (const k of NUMERIC) f[k] = c[k] == null ? "" : String(c[k]);
  for (const k of PRICING_NUMERIC) f[k] = c.provider_pricing?.[k] == null ? "" : String(c.provider_pricing[k]);
  return f;
}

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${v}" is not a non-negative number`);
  return n;
}

function ccy(v: string): string | null {
  const s = v.trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{3}$/.test(s)) throw new Error(`"${v}" is not a 3-letter currency code`);
  return s;
}

function toPatch(f: Form): Record<string, unknown> {
  const pricing: Record<string, unknown> = {};
  for (const k of PRICING_NUMERIC) {
    const n = num(f[k]);
    if (n != null) pricing[k] = n;
  }
  const pc = ccy(f.pricing_currency);
  if (pc) pricing.currency = pc;
  if (f.pricing_source.trim()) pricing.source = f.pricing_source.trim();
  if (f.pricing_as_of.trim()) pricing.as_of = f.pricing_as_of.trim();
  const patch: Record<string, unknown> = {
    image_provider: f.image_provider || null,
    image_model: f.image_model.trim() || null,
    analysis_provider: f.analysis_provider || null,
    analysis_model: f.analysis_model.trim() || null,
    budget_currency: ccy(f.budget_currency),
    economics_currency: ccy(f.economics_currency),
    reviewer_membership_ids: f.reviewers ? f.reviewers.split(",").map(Number) : [],
    provider_data_approved: f.approved === "1",
    provider_pricing: pricing,
  };
  for (const k of NUMERIC) patch[k] = num(f[k]);
  return patch;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ProviderKeyCard({ isAdmin }: { isAdmin: boolean }) {
  const status = useLiveQuery(fetchProviderStatus, []);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const openai = status.data?.find((s) => s.provider === "openai");
  async function save() {
    setBusy(true);
    try {
      await setProviderKey("openai", key.trim());
      setKey("");
      toast.success("OpenAI key stored in Vault");
      await status.reload();
    } catch (e) {
      toast.error("Key not stored", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" aria-hidden /> OpenAI connection
        </div>
        {status.data &&
          (openai?.key_set ? (
            <Pill tone="good">Key stored {openai.set_at ? new Date(openai.set_at).toLocaleDateString() : ""}</Pill>
          ) : (
            <Pill tone="warn">No key</Pill>
          ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Stored in Supabase Vault. Only the generation worker (service role) can read it; it is never shown again here,
        logged, or sent to the browser. Supporting backgrounds send a text prompt only; poster analysis sends the poster
        image and needs the per-brand data approval below.
      </p>
      {isAdmin ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="min-w-[260px] flex-1">
            <Label htmlFor="openai-key" className="text-xs">
              {openai?.key_set ? "Rotate key" : "API key"}
            </Label>
            <Input
              id="openai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || key.trim().length < 20}>
            {busy ? "Storing…" : "Store in Vault"}
          </Button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Only an HQ admin can set or rotate the key.</p>
      )}
    </div>
  );
}

function BrandConfigForm({ brandId, isAdmin, onSaved }: { brandId: number; isAdmin: boolean; onSaved: () => void }) {
  const cfg = useLiveQuery(() => fetchRuntimeConfig(brandId), [brandId]);
  if (cfg.error) return <ErrorState title="Config failed to load" description={cfg.error} retry={() => void cfg.reload()} />;
  if (!cfg.data) return <SkeletonCards count={2} />;
  // keyed by version: a save reloads the config and re-initialises the editor
  return (
    <BrandConfigEditor
      key={`${brandId}:${cfg.data.version}`}
      brandId={brandId}
      config={cfg.data}
      isAdmin={isAdmin}
      onSaved={async () => {
        await cfg.reload();
        onSaved();
      }}
    />
  );
}

function BrandConfigEditor({
  brandId,
  config,
  isAdmin,
  onSaved,
}: {
  brandId: number;
  config: RuntimeConfig;
  isAdmin: boolean;
  onSaved: () => Promise<void>;
}) {
  const members = useLiveQuery(fetchWorkspaceMembers, []);
  const [form, setForm] = useState<Form>(() => toForm(config));
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const ro = !isAdmin;
  const reviewers = new Set(form.reviewers ? form.reviewers.split(",") : []);
  const toggleReviewer = (id: string, on: boolean) => {
    const next = new Set(reviewers);
    if (on) next.add(id);
    else next.delete(id);
    setForm({ ...form, reviewers: [...next].join(",") });
  };
  async function save() {
    let patch: Record<string, unknown>;
    try {
      patch = toPatch(form);
    } catch (e) {
      toast.error("Check the form", { description: e instanceof Error ? e.message : String(e) });
      return;
    }
    setBusy(true);
    try {
      await setRuntimeConfig(brandId, patch, config.version);
      toast.success("Owner decisions saved (versioned and audited)");
      await onSaved();
    } catch (e) {
      toast.error("Not saved", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }
  const missing = config.missing_config as MissingConfigKey[];
  const select = "h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Still missing: {missing.map((k) => MISSING_CONFIG_LABELS[k]?.label ?? k).join(" · ")}
        </p>
      )}
      <fieldset disabled={ro || busy} className="grid gap-3 md:grid-cols-4">
        <Field id="img-prov" label="Image provider">
          <select id="img-prov" className={select} value={form.image_provider} onChange={set("image_provider")}>
            <option value="openai">OpenAI</option>
            <option value="fixture">Fixture (zero cost, never launchable)</option>
          </select>
        </Field>
        <Field id="img-model" label="Image model" hint="Exact OpenAI model id; not defaulted.">
          <Input id="img-model" value={form.image_model} onChange={set("image_model")} />
        </Field>
        <Field id="an-prov" label="Analysis provider">
          <select id="an-prov" className={select} value={form.analysis_provider} onChange={set("analysis_provider")}>
            <option value="openai">OpenAI</option>
          </select>
        </Field>
        <Field id="an-model" label="Analysis (vision) model">
          <Input id="an-model" value={form.analysis_model} onChange={set("analysis_model")} />
        </Field>

        <Field id="budget" label="Batch spend ceiling" hint="Reserved per call before it runs; the batch pauses rather than overspend.">
          <Input id="budget" inputMode="decimal" value={form.batch_budget_amount} onChange={set("batch_budget_amount")} />
        </Field>
        <Field id="budget-ccy" label="Budget currency">
          <Input id="budget-ccy" maxLength={3} value={form.budget_currency} onChange={set("budget_currency")} placeholder="USD" />
        </Field>
        <Field id="cap" label="Max cost per candidate">
          <Input id="cap" inputMode="decimal" value={form.max_cost_per_candidate} onChange={set("max_cost_per_candidate")} />
        </Field>
        <Field id="price-ccy" label="Price currency">
          <Input id="price-ccy" maxLength={3} value={form.pricing_currency} onChange={set("pricing_currency")} placeholder="USD" />
        </Field>

        <Field id="est-img" label="Estimate per image call" hint="From your OpenAI pricing page; used for reservation.">
          <Input id="est-img" inputMode="decimal" value={form.image_estimate_per_call} onChange={set("image_estimate_per_call")} />
        </Field>
        <Field id="est-an" label="Estimate per analysis call">
          <Input id="est-an" inputMode="decimal" value={form.analysis_estimate_per_call} onChange={set("analysis_estimate_per_call")} />
        </Field>
        <Field id="p-src" label="Price source">
          <Input id="p-src" value={form.pricing_source} onChange={set("pricing_source")} placeholder="OpenAI pricing page" />
        </Field>
        <Field id="p-asof" label="Prices as of">
          <Input id="p-asof" type="date" value={form.pricing_as_of} onChange={set("pricing_as_of")} />
        </Field>

        <Field id="r-ti" label="Text input / 1M tokens" hint="Optional; with these, actual cost is computed from usage.">
          <Input id="r-ti" inputMode="decimal" value={form.text_input_per_mtok} onChange={set("text_input_per_mtok")} />
        </Field>
        <Field id="r-to" label="Text output / 1M tokens">
          <Input id="r-to" inputMode="decimal" value={form.text_output_per_mtok} onChange={set("text_output_per_mtok")} />
        </Field>
        <Field id="r-ii" label="Image input / 1M tokens">
          <Input id="r-ii" inputMode="decimal" value={form.image_input_per_mtok} onChange={set("image_input_per_mtok")} />
        </Field>
        <Field id="r-io" label="Image output / 1M tokens">
          <Input id="r-io" inputMode="decimal" value={form.image_output_per_mtok} onChange={set("image_output_per_mtok")} />
        </Field>

        <Field id="cpa" label="Target CPA">
          <Input id="cpa" inputMode="decimal" value={form.target_cpa} onChange={set("target_cpa")} />
        </Field>
        <Field id="roas" label="Target ROAS">
          <Input id="roas" inputMode="decimal" value={form.target_roas} onChange={set("target_roas")} />
        </Field>
        <Field id="econ-ccy" label="Economics currency">
          <Input id="econ-ccy" maxLength={3} value={form.economics_currency} onChange={set("economics_currency")} placeholder="MYR" />
        </Field>
        <Field id="media" label="Media-test budget">
          <Input id="media" inputMode="decimal" value={form.media_test_budget_amount} onChange={set("media_test_budget_amount")} />
        </Field>
      </fieldset>

      <fieldset disabled={ro || busy} className="space-y-2">
        <legend className="text-xs font-medium">Named reviewers</legend>
        <div className="flex flex-wrap gap-3">
          {(members.data ?? [])
            .filter((m) => m.role_key === "hq_admin" || m.role_key === "marketing_growth")
            .map((m) => (
              <label key={m.membership_id} className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={reviewers.has(String(m.membership_id))}
                  onCheckedChange={(v) => toggleReviewer(String(m.membership_id), v === true)}
                />
                {m.display_name}
              </label>
            ))}
        </div>
      </fieldset>

      <fieldset disabled={ro || busy}>
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={form.approved === "1"} onCheckedChange={(v) => setForm({ ...form, approved: v === true ? "1" : "" })} />
          <span>
            I approve sending this brand&apos;s owned poster images to the selected provider for analysis. (Background generation
            sends text prompts only.)
          </span>
        </label>
      </fieldset>

      {isAdmin ? (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={busy}>
            <Save className="size-3.5" /> {busy ? "Saving…" : "Save owner decisions"}
          </Button>
          <span className="text-[11px] text-muted-foreground">Version {config.version} · every save is versioned and audited</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Read-only — only an HQ admin can change owner decisions.</p>
      )}
    </form>
  );
}

export function OwnerConfigPanel({ rows, onSaved }: { rows: BrandReadinessRow[]; onSaved: () => void }) {
  const session = useSession();
  const isAdmin = session.role === "hq_admin";
  const [brandId, setBrandId] = useState<number | null>(rows.find((r) => r.brand_slug === "adipocyde")?.brand_id ?? rows[0]?.brand_id ?? null);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Provider and owner decisions</h2>
      <ProviderKeyCard isAdmin={isAdmin} />
      {brandId != null && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Label htmlFor="cfg-brand" className="text-sm font-medium">
              Brand
            </Label>
            <select
              id="cfg-brand"
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={brandId}
              onChange={(e) => setBrandId(Number(e.target.value))}
            >
              {rows.map((r) => (
                <option key={r.brand_id} value={r.brand_id}>
                  {r.brand_name}
                </option>
              ))}
            </select>
          </div>
          <BrandConfigForm key={brandId} brandId={brandId} isAdmin={isAdmin} onSaved={onSaved} />
        </div>
      )}
    </section>
  );
}
