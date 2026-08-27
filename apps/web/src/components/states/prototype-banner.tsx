"use client";

import { FlaskConical } from "lucide-react";
import { useSession } from "@/hooks/use-session";

/**
 * Marks a surface that still runs on the seeded prototype dataset. Rendered
 * only for a live session — on demo builds the whole app is the prototype
 * and the sidebar already says so. Never silent: an operator must be able to
 * tell at a glance that nothing on the page is EFFEN's real data.
 */
export function PrototypeBanner({ module }: { module: string }) {
  const session = useSession();
  if (session.authEmail === null) return null;
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Prototype on synthetic data.</span> {module} is not connected to a live source
        yet — every figure, name and action on this page is seeded and stays in the browser. Nothing here reflects
        the real business.
      </span>
    </p>
  );
}
