"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { cn } from "@/lib/utils";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

/** Mirrors a queue Card (header + row list) while the floor snapshot loads. */
export function QueueCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-8 rounded-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Error / loading / refreshing wrapper every floor page puts its body in.
 * Nothing here is confirmed clear while the fetch is failing or in flight.
 */
export function FloorFrame({
  children,
  skeleton,
}: {
  children: React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  const { error, loading, refreshing, reload } = useFulfilmentFloor();

  if (error) {
    return (
      <ErrorState
        title="Could not load the fulfilment floor"
        description={`Queues and exceptions are unavailable right now — nothing here is confirmed clear. ${error}`}
        retry={() => void reload()}
      />
    );
  }
  if (loading) {
    return (
      <div className="space-y-5" role="status" aria-label="Loading fulfilment floor">
        {skeleton ?? <QueueCardSkeleton rows={4} />}
      </div>
    );
  }
  return (
    <div className={cn("space-y-5", refreshing && "pointer-events-none opacity-60")} aria-busy={refreshing || undefined}>
      {children}
    </div>
  );
}
