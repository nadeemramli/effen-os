/**
 * Creative format classification — the TypeScript twin of
 * warehouse/models/staging/stg_meta_creative_media.sql, used by fixtures
 * and tests so both sides agree on the edge cases. Precedence:
 * asset_feed_spec (dynamic) > carousel > video > single image hash >
 * existing post > unknown. Only `single_image` yields a poster identity;
 * a video thumbnail is a preview, never a poster.
 */
import type { CreativeFormat } from "./types";

export interface RawCreative {
  id: string;
  object_type?: string | null;
  image_hash?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  video_id?: string | null;
  effective_object_story_id?: string | null;
  object_story_spec?: {
    link_data?: { image_hash?: string; child_attachments?: unknown[] };
    photo_data?: { image_hash?: string };
    video_data?: { video_id?: string };
  } | null;
  asset_feed_spec?: Record<string, unknown> | null;
}

export interface ClassifiedCreative {
  creative_id: string;
  creative_format: CreativeFormat;
  image_hash: string | null;
  image_url: string | null;
  preview_thumbnail_url: string | null;
  is_poster_eligible: boolean;
}

const FEED_KEYS = ["ad_formats", "images", "videos", "bodies", "titles"];

export function classifyCreative(c: RawCreative): ClassifiedCreative {
  const spec = c.object_story_spec ?? null;
  const rawHash = c.image_hash ?? spec?.link_data?.image_hash ?? spec?.photo_data?.image_hash ?? null;
  const videoId = c.video_id ?? spec?.video_data?.video_id ?? null;
  const hasFeed = !!c.asset_feed_spec && FEED_KEYS.some((k) => c.asset_feed_spec![k] != null);
  const children = spec?.link_data?.child_attachments?.length ?? 0;
  const hasSpec = !!spec && (spec.link_data != null || spec.video_data != null || spec.photo_data != null);

  let format: CreativeFormat;
  if (hasFeed) format = "dynamic";
  else if (children > 0) format = "carousel";
  else if (videoId != null || c.object_type === "VIDEO") format = "video";
  else if (rawHash != null) format = "single_image";
  else if (!hasSpec && c.effective_object_story_id) format = "existing_post";
  else format = "unknown";

  const single = format === "single_image";
  return {
    creative_id: c.id,
    creative_format: format,
    image_hash: single ? rawHash : null,
    image_url: single ? (c.image_url ?? null) : null,
    preview_thumbnail_url: c.thumbnail_url ?? null,
    is_poster_eligible: single && rawHash != null,
  };
}

export interface AdDay {
  date: string;
  ad_id: string;
  creative_id: string | null;
  spend: number;
  purchases: number;
}

/**
 * Roll ad-days up to exact images the way mart_creative_image_daily does:
 * only bound single-image ads contribute; nothing is allocated. Returns the
 * image totals plus the ad-level remainder that stays unattributed.
 */
export function rollUpToImages(
  adDays: readonly AdDay[],
  creatives: ReadonlyMap<string, ClassifiedCreative>,
): { images: Map<string, { spend: number; purchases: number; ads: Set<string> }>; unattributedSpend: number } {
  const images = new Map<string, { spend: number; purchases: number; ads: Set<string> }>();
  let unattributedSpend = 0;
  for (const d of adDays) {
    const c = d.creative_id ? creatives.get(d.creative_id) : undefined;
    if (!c || !c.is_poster_eligible || !c.image_hash) {
      unattributedSpend += d.spend;
      continue;
    }
    const cur = images.get(c.image_hash) ?? { spend: 0, purchases: 0, ads: new Set<string>() };
    cur.spend += d.spend;
    cur.purchases += d.purchases;
    cur.ads.add(d.ad_id);
    images.set(c.image_hash, cur);
  }
  return { images, unattributedSpend };
}
