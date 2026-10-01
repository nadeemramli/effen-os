{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}
-- Poster identity is reserved for single-image creatives. A carousel,
-- dynamic or video row carrying an image_hash would let its totals be
-- credited to one picture; a video thumbnail must never become a poster.
select creative_id, creative_format, image_hash
from {{ ref('stg_meta_creative_media') }}
where (creative_format != 'single_image' and (image_hash is not null or image_url is not null))
   or (is_poster_eligible and creative_format != 'single_image')
