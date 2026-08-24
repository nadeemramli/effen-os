"use client";

import { LiveGuard } from "@/components/auth/live-guard";
import { FulfilmentFloorProvider } from "./_lib/fulfilment-floor";

/**
 * The live fulfilment floor: Overview, Ship-readiness, Exceptions, Returns
 * share one snapshot. Placeholder tools sit in the sibling (next) group so
 * they render without the live gate.
 */
export default function FulfilmentFloorLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveGuard>
      <FulfilmentFloorProvider>{children}</FulfilmentFloorProvider>
    </LiveGuard>
  );
}
