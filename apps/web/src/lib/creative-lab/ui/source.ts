"use client";

import { useSession } from "@/hooks/use-session";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Where a Creative Lab page gets its data. `live` = signed-in session on a
 * configured project (RPCs; may be not-provisioned). `fixture` = demo build
 * or signed-out preview, always rendered under the fixture banner.
 */
export type LabSource = "live" | "fixture";

export function useLabSource(): LabSource {
  const session = useSession();
  return isSupabaseConfigured() && session.authEmail !== null ? "live" : "fixture";
}

/** Brand inventory as REPORTED by the handover; not verified in this repo. */
export const HANDOVER_INVENTORY: Array<{ slug: string; name: string; packshotsReported: number; note: string }> = [
  { slug: "adipocyde", name: "Adipocyde", packshotsReported: 9, note: "Pilot brand (Meta single-image sales ads, MY/SG cohorts)" },
  { slug: "nurokids", name: "NuroKids", packshotsReported: 9, note: "" },
  { slug: "cavernosil", name: "Cavernosil", packshotsReported: 5, note: "" },
  { slug: "glycoxil", name: "Glycoxil", packshotsReported: 5, note: "" },
  { slug: "lipidri", name: "Lipidri", packshotsReported: 5, note: "" },
  { slug: "synovil", name: "Synovil", packshotsReported: 0, note: "Active website/ad reference; no packshots supplied" },
];
