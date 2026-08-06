-- Creative content signals for brand resolution, across all per-account
-- tables: destination URL (all creative shapes) and page identity.
with unioned as (
  {{ union_meta_stream('ad_creatives',
    'id, link_url, object_story_spec, asset_feed_spec, actor_id,
     url_tags') }}
)

select
  id as creative_id,
  coalesce(
    link_url,
    json_value(object_story_spec, '$.link_data.link'),
    json_value(asset_feed_spec, '$.link_urls[0].website_url'),
    json_value(object_story_spec, '$.video_data.call_to_action.value.link')
  ) as destination_url,
  net.reg_domain(coalesce(
    link_url,
    json_value(object_story_spec, '$.link_data.link'),
    json_value(asset_feed_spec, '$.link_urls[0].website_url'),
    json_value(object_story_spec, '$.video_data.call_to_action.value.link')
  )) as destination_domain,
  coalesce(json_value(object_story_spec, '$.page_id'), actor_id) as page_id,
  json_value(object_story_spec, '$.instagram_actor_id') as instagram_actor_id,
  url_tags
from unioned
