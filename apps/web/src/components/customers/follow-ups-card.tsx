"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import { workItemActionLabel, type WorkItem } from "@/lib/domain/cohorts";
import { fetchCustomerWorkItems } from "@/lib/supabase/live";
import { FollowUpDialog, OpenWorkItem } from "./follow-up-dialog";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
}

/**
 * Customer 360 card: open follow-ups with Done / Drop, recent closed ones,
 * and a button to log a new one. Internal work items only — no send path.
 */
export function FollowUpsCard({ identityKey, displayName }: { identityKey: string; displayName: string | null }) {
  const canFollowUp = usePermission("customers.followup");
  const [dialogOpen, setDialogOpen] = useState(false);
  const items = useLiveQuery<WorkItem[]>(() => fetchCustomerWorkItems([identityKey]), [identityKey]);
  const open = (items.data ?? []).filter((w) => w.status === "open");
  const closed = (items.data ?? []).filter((w) => w.status !== "open").slice(0, 5);

  const replace = (item: WorkItem) => {
    // Keep the card in sync without a refetch; the server row is authoritative.
    void items.reload();
    return item;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Follow-ups</CardTitle>
        {canFollowUp && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" aria-hidden /> Log
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {items.error ? (
          <p className="text-muted-foreground">Could not load follow-ups: {items.error}</p>
        ) : items.loading ? (
          <div className="space-y-1.5" role="status" aria-label="Loading follow-ups">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : open.length === 0 && closed.length === 0 ? (
          <p className="text-muted-foreground">No follow-ups logged. Work items are internal and audited; nothing is sent to the customer.</p>
        ) : (
          <>
            {open.map((w) => (
              <OpenWorkItem key={w.id} item={w} canClose={canFollowUp} onClosed={replace} />
            ))}
            {closed.length > 0 && (
              <ul className="space-y-0.5 border-t pt-2 text-[11px] text-muted-foreground">
                {closed.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2">
                    <span>{workItemActionLabel(w.next_action)} · {w.status}</span>
                    <span className="tnum">{when(w.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
      <FollowUpDialog
        target={dialogOpen ? { identityKey, displayName } : null}
        source="customer_360"
        onClose={() => setDialogOpen(false)}
        onCreated={() => void items.reload()}
      />
    </Card>
  );
}
