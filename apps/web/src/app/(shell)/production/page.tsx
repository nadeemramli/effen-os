"use client";

import Link from "next/link";
import { Factory } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";

const STAGES = ["Planned", "Materials issued", "In production", "QC", "FG received"];

function ProductionInner() {
  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Production"
        description="Work orders from demand to finished-goods receipt: BOM check, batch, yield, QC. FG receipt lands stock into sellable inventory."
      />

      <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
        <Factory className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
        <h2 className="text-sm font-medium">No live production source connected</h2>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          Production runs with the manufacturer today and is not captured in any connected system, so this
          screen shows nothing rather than something invented. Work-order capture ({STAGES.join(" → ")})
          lands with the production spine; finished-goods receipts will then feed{" "}
          <Link href="/inventory" className="text-info underline-offset-2 hover:underline">Inventory</Link>{" "}
          on-hand and batch-level COGS in{" "}
          <Link href="/catalog/products" className="text-info underline-offset-2 hover:underline">the catalog</Link>.
        </p>
        <p className="mt-3 max-w-md text-xs text-muted-foreground">
          Until then, per-unit COGS is entered directly on variants (effective-dated, audited) — enough for
          contribution, LTV, and commission math.
        </p>
      </div>
    </PageBody>
  );
}

export default function ProductionPage() {
  return (
    <LiveGuard>
      <ProductionInner />
    </LiveGuard>
  );
}
