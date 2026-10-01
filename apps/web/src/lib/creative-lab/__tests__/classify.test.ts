import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCreative, rollUpToImages, type AdDay, type ClassifiedCreative } from "../classify";

test("dynamic creative wins over a top-level image hash", () => {
  const c = classifyCreative({ id: "1", image_hash: "h", asset_feed_spec: { images: [{ hash: "a" }, { hash: "b" }] } });
  assert.equal(c.creative_format, "dynamic");
  assert.equal(c.image_hash, null);
  assert.equal(c.is_poster_eligible, false);
});

test("carousel never exposes a single image", () => {
  const c = classifyCreative({ id: "2", object_story_spec: { link_data: { image_hash: "h", child_attachments: [{}, {}] } } });
  assert.equal(c.creative_format, "carousel");
  assert.equal(c.image_hash, null);
});

test("a video thumbnail is a preview, never a poster", () => {
  const c = classifyCreative({ id: "3", video_id: "v1", thumbnail_url: "https://cdn/thumb.jpg", image_url: "https://cdn/x.jpg" });
  assert.equal(c.creative_format, "video");
  assert.equal(c.image_hash, null);
  assert.equal(c.image_url, null);
  assert.equal(c.preview_thumbnail_url, "https://cdn/thumb.jpg");
  assert.equal(c.is_poster_eligible, false);
  const v2 = classifyCreative({ id: "3b", object_type: "VIDEO", image_hash: "h" });
  assert.equal(v2.creative_format, "video");
});

test("single image via link_data or photo_data", () => {
  const a = classifyCreative({ id: "4", object_story_spec: { link_data: { image_hash: "abc" } }, image_url: "u" });
  assert.equal(a.creative_format, "single_image");
  assert.equal(a.image_hash, "abc");
  assert.equal(a.image_url, "u");
  assert.ok(a.is_poster_eligible);
  assert.equal(classifyCreative({ id: "5", object_story_spec: { photo_data: { image_hash: "p" } } }).image_hash, "p");
});

test("existing posts and empty creatives stay explicit unknowns", () => {
  assert.equal(classifyCreative({ id: "6", effective_object_story_id: "123_456" }).creative_format, "existing_post");
  assert.equal(classifyCreative({ id: "7" }).creative_format, "unknown");
});

test("roll-up conserves spend and never allocates carousel totals to images", () => {
  const creatives = new Map<string, ClassifiedCreative>([
    ["single", classifyCreative({ id: "single", image_hash: "img1" })],
    ["single2", classifyCreative({ id: "single2", image_hash: "img1" })], // same picture, second creative
    ["carousel", classifyCreative({ id: "carousel", object_story_spec: { link_data: { child_attachments: [{}, {}, {}] } } })],
  ]);
  const days: AdDay[] = [
    { date: "d1", ad_id: "a1", creative_id: "single", spend: 10, purchases: 1 },
    { date: "d2", ad_id: "a1", creative_id: "single", spend: 5, purchases: 0 },
    { date: "d1", ad_id: "a2", creative_id: "single2", spend: 7, purchases: 2 },
    { date: "d1", ad_id: "a3", creative_id: "carousel", spend: 100, purchases: 9 },
    { date: "d1", ad_id: "a4", creative_id: null, spend: 3, purchases: 0 },
  ];
  const { images, unattributedSpend } = rollUpToImages(days, creatives);
  const img = images.get("img1")!;
  assert.equal(img.spend, 22);
  assert.equal(img.purchases, 3);
  assert.equal(img.ads.size, 2);
  assert.equal(unattributedSpend, 103);
  assert.equal(img.spend + unattributedSpend, days.reduce((a, d) => a + d.spend, 0));
});
