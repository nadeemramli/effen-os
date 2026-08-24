"use client";

import Link from "next/link";
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { InlineCount, RefreshChip } from "@/components/states";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

/** Courier manifest buttons — a write action that arrives with the Slice 3 pilot. */
export function ManifestButtons() {
  const { loading, refreshing, pendingPickup } = useFulfilmentFloor();
  return (
    <div className="flex items-center gap-2">
      {refreshing && <RefreshChip />}
      {(["ninja_van", "jnt"] as const).map((c) => {
        const count = c === "ninja_van" ? pendingPickup.length : 0;
        return (
          <Button
            key={c}
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled
            title="Handover booking is a write action — arrives with the Slice 3 pilot. Fighter closes today's manifests."
          >
            <Truck className="size-3.5" aria-hidden />
            {c === "jnt" ? "J&T" : "Ninja Van"} manifest
            <Badge variant="secondary" className="tnum ml-1 h-4 px-1 text-[10px]">
              <InlineCount value={loading ? null : count} width="w-3" />
            </Badge>
          </Button>
        );
      })}
    </div>
  );
}

/** Live read-only banner with the ship-readiness summary and a link to its lane. */
export function ReadinessStrip({ linkToReadiness = true }: { linkToReadiness?: boolean }) {
  const { readiness } = useFulfilmentFloor();
  return (
    <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      Live read-only floor: order queues mirror the stores, parcel stages mirror Ninja Van. Pick/pack/handover
      actions arrive with the Slice 3 write pilot.
      {readiness.checked > 0 && (
        <>
          {" "}
          <span className="font-medium text-foreground">
            Ship-readiness gate: {(readiness.checked - readiness.flagged).toLocaleString()} of{" "}
            {readiness.checked.toLocaleString()} pre-ship orders (14d) pass validation ·{" "}
            {readiness.flagged.toLocaleString()} need fixing
            {readiness.corrected > 0 && ` · ${readiness.corrected.toLocaleString()} corrected in Fullkit, staged`}.
          </span>
          {linkToReadiness && (
            <>
              {" "}
              <Link href="/fulfilment/readiness" className="text-info underline-offset-2 hover:underline">
                Open Ship-readiness
              </Link>
            </>
          )}
        </>
      )}
    </p>
  );
}

/** Page header shared by the floor pages; the Overview adds the manifest buttons. */
export function FloorPageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  const { refreshing } = useFulfilmentFloor();
  return (
    <PageHeader title={title} description={description}>
      {children ?? (refreshing ? <RefreshChip /> : null)}
    </PageHeader>
  );
}
