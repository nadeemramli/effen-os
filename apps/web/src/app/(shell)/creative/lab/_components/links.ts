import type { ImageLeaderboardRow } from "@/lib/creative-lab/types";

export function imageHref(r: Pick<ImageLeaderboardRow, "account_id" | "image_hash">, source: "live" | "fixture", brandId?: number | null) {
  const q = new URLSearchParams({ account: r.account_id, hash: r.image_hash, source });
  if (brandId != null) q.set("brand", String(brandId));
  return `/creative/lab/leaderboard/image?${q.toString()}`;
}
