-- Creative media identity and format, one row per creative_id (ADR-0010).
--
-- The poster system needs to know, for every creative, whether its
-- delivery can be attributed to ONE exact image. Only `single_image` can.
-- Carousel, dynamic/flexible (asset_feed_spec) and video creatives keep
-- their platform totals at ad grain and never fan out to child images;
-- a video's thumbnail_url is a preview, not a poster, so it is carried as
-- `preview_thumbnail_url` and never as `image_hash`/`image_url`.
--
-- Precedence matters: asset_feed_spec wins over everything (Meta may also
-- fill a top-level image_hash for a dynamic creative), then carousel, then
-- video, then a single image hash. Anything else stays `unknown` /
-- `existing_post` rather than being guessed.
{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}

with unioned as (
  {{ union_meta_stream_columns('ad_creatives',
      required=['id', 'object_story_spec', 'asset_feed_spec', 'link_url'],
      optional=['account_id', 'name', 'status', 'object_type', 'image_hash',
                'image_url', 'thumbnail_url', 'video_id', 'body', 'title',
                'call_to_action_type', 'effective_object_story_id',
                'object_story_id', '_airbyte_extracted_at']) }}
),

parsed as (
  select
    id as creative_id,
    cast(account_id as string) as account_id,
    name as creative_name,
    status as creative_status,
    object_type,
    coalesce(
      image_hash,
      json_value(object_story_spec, '$.link_data.image_hash'),
      json_value(object_story_spec, '$.photo_data.image_hash')
    ) as raw_image_hash,
    image_url as raw_image_url,
    thumbnail_url,
    coalesce(video_id, json_value(object_story_spec, '$.video_data.video_id')) as video_id,
    coalesce(array_length(json_query_array(object_story_spec, '$.link_data.child_attachments')), 0)
      as child_attachment_count,
    -- key probes work whether Airbyte landed the spec as JSON or STRING
    coalesce(
      json_query(asset_feed_spec, '$.ad_formats'), json_query(asset_feed_spec, '$.images'),
      json_query(asset_feed_spec, '$.videos'), json_query(asset_feed_spec, '$.bodies'),
      json_query(asset_feed_spec, '$.titles')
    ) is not null as has_asset_feed,
    coalesce(array_length(json_query_array(asset_feed_spec, '$.images')), 0) as feed_image_count,
    coalesce(array_length(json_query_array(asset_feed_spec, '$.videos')), 0) as feed_video_count,
    coalesce(
      json_query(object_story_spec, '$.page_id'), json_query(object_story_spec, '$.link_data'),
      json_query(object_story_spec, '$.video_data'), json_query(object_story_spec, '$.photo_data')
    ) is not null as has_story_spec,
    coalesce(body, json_value(object_story_spec, '$.link_data.message')) as primary_text,
    coalesce(title, json_value(object_story_spec, '$.link_data.name')) as headline,
    coalesce(call_to_action_type,
      json_value(object_story_spec, '$.link_data.call_to_action.type')) as call_to_action_type,
    coalesce(
      link_url,
      json_value(object_story_spec, '$.link_data.link'),
      json_value(asset_feed_spec, '$.link_urls[0].website_url'),
      json_value(object_story_spec, '$.video_data.call_to_action.value.link')
    ) as destination_url,
    coalesce(effective_object_story_id, object_story_id) as story_id,
    _airbyte_extracted_at as extracted_at,
    _source_table
  from unioned
),

classified as (
  select
    *,
    case
      when has_asset_feed then 'dynamic'
      when child_attachment_count > 0 then 'carousel'
      when video_id is not null or object_type = 'VIDEO' then 'video'
      when raw_image_hash is not null then 'single_image'
      when not has_story_spec and story_id is not null then 'existing_post'
      else 'unknown'
    end as creative_format
  from parsed
)

select
  creative_id,
  account_id,
  creative_name,
  creative_status,
  object_type,
  creative_format,
  -- exact-image identity only where delivery maps to one image
  if(creative_format = 'single_image', raw_image_hash, null) as image_hash,
  if(creative_format = 'single_image', raw_image_url, null) as image_url,
  -- previews (video/carousel/dynamic) are never posters
  thumbnail_url as preview_thumbnail_url,
  video_id,
  child_attachment_count,
  feed_image_count,
  feed_video_count,
  primary_text,
  headline,
  call_to_action_type,
  destination_url,
  story_id,
  creative_format = 'single_image' and raw_image_hash is not null as is_poster_eligible,
  extracted_at,
  _source_table
from classified
-- the same creative can surface in more than one account table (shared
-- creative library); keep one deterministic row, newest extraction first
qualify row_number() over (
  partition by creative_id
  order by extracted_at desc nulls last, _source_table
) = 1
