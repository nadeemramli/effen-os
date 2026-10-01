"use client";

import { DatabaseZap, FlaskConical, Scale } from "lucide-react";
import { FIXTURE_LABEL } from "@/lib/creative-lab/fixtures";

/** Every fixture view carries this. Fixture numbers are never real ad results. */
export function FixtureBanner({ what }: { what: string }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">{FIXTURE_LABEL}.</span> {what}
      </span>
    </p>
  );
}

/** Live session, but the ADR-0010 schema/sync is not applied yet. */
export function NotProvisioned({ detail }: { detail?: string }) {
  return (
    <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-warning">
        <DatabaseZap className="size-4" aria-hidden /> Creative Lab is not provisioned on this project
      </div>
      <p className="mt-1 text-muted-foreground">
        {detail ?? "The creative schema and RPCs from ADR-0010 have not been applied."} Release steps, each needing owner
        authorisation: apply the <code>creative_lab_v1</code> migrations; run the warehouse field audit and enable{" "}
        <code>creative_media_enabled</code>; deploy <code>creative-mart-sync</code>. Nothing on this page is inferred
        in the meantime.
      </p>
    </div>
  );
}

export function ProvisionalNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Scale className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

const TONE: Record<string, string> = {
  good: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

export function Pill({ tone = "muted", children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}
