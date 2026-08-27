"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { ErrorState, SkeletonCards } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useSession } from "@/hooks/use-session";
import { RouteGuard } from "@/lib/rbac/guard";
import { fetchWooConnections } from "@/lib/supabase/live";
import { DraftDialog } from "../_components/draft-dialog";
import { DemoMakeOrder } from "./_components/demo-make-order";

/**
 * Make order. With a live session this is the server-side draft composer
 * (R19): the draft is saved and audited, confirmed into New / QC from the
 * Drafts page, and the store order is created only when the write path is
 * enabled. The seeded prototype (canned chat extraction, in-memory submit)
 * renders only on builds without Supabase.
 */
export default function NewOrderPage() {
  const session = useSession();
  if (session.authEmail === null) return <DemoMakeOrder />;
  return (
    <LiveGuard>
      <RouteGuard permission="orders.create">
        <MakeOrderLive />
      </RouteGuard>
    </LiveGuard>
  );
}

function MakeOrderLive() {
  const router = useRouter();
  const conns = useLiveQuery(fetchWooConnections, []);
  const stores = (conns.data ?? []).filter((c) => c.status !== "pending_setup");

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="Make order"
        description="Capture a manual sale as a Fullkit draft. Nothing is written to the store, no stock is reserved and no courier is booked until the write path is enabled."
      >
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/orders/drafts"><ArrowLeft className="size-3.5" aria-hidden /> Drafts</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">How a manual order moves</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>1. Save the draft here (idempotent, audited, safe to leave half-done).</p>
          <p>2. Confirm it on the Drafts page — it enters New / QC with an explicit QC state.</p>
          <p>3. The store order and the courier booking come only when the write path is enabled (ADR-0006). Fighter still does both today.</p>
        </CardContent>
      </Card>

      {conns.error ? (
        <ErrorState title="Could not load the stores" description={conns.error} retry={() => void conns.reload()} />
      ) : conns.loading ? (
        <SkeletonCards count={1} />
      ) : (
        <DraftDialog
          draft={null}
          connections={stores}
          title="Make order"
          onClose={() => router.push("/orders/drafts")}
          onSaved={() => {
            toast.info("Confirm it from Drafts to send it into New / QC");
            router.push("/orders/drafts");
          }}
        />
      )}
    </PageBody>
  );
}
