-- Creative media field-coverage audit (ADR-0010, Slice 0). READ-ONLY.
--
-- Run as one BigQuery script in the console (asia-southeast1) with any
-- principal that can read `effen-growth-prod.raw`. It creates only
-- session TEMP tables; nothing in raw/staging/marts is touched.
--
-- Why a script and not a dbt model: the per-account Airbyte tables may
-- not all carry the media columns (Airbyte materialises a column once a
-- stream has seen it). Every row is read through TO_JSON(t), so an absent
-- column reads as NULL instead of failing the query. The answers decide
-- whether `creative_media_enabled` can be switched on for the dbt build.
--
-- Questions answered, in result order:
--   Q1  which media columns exist, per stream, in how many account tables
--   Q2  creative-format mix and media-field fill rate (ad_creatives)
--   Q3  last-90-day spend share by format and by binding status — how
--       much spend can be tied to one exact image without fan-out
--   Q4  cardinality: duplicate ad_id / creative_id across account tables
--   Q5  attribution setting and account timezone values actually present
--   Q6  the proof row: top-spend single-image ad → creative → image hash
--       → the CDN URL the archiver would fetch (bytes → SHA-256 in GCS)

-- ---------------------------------------------------------------------
-- Q1 column inventory
-- ---------------------------------------------------------------------
select
  regexp_extract(table_name, r'^meta_.+_(ads_insights|ad_creatives|ads|campaigns|ad_account|images|videos)$') as stream,
  column_name,
  any_value(data_type) as data_type,
  count(distinct data_type) as distinct_types,   -- >1 breaks a UNION ALL
  count(distinct table_name) as tables_with_column,
  (select count(distinct t2.table_name)
     from `effen-growth-prod.raw`.INFORMATION_SCHEMA.TABLES t2
     where regexp_contains(t2.table_name,
       concat(r'^meta_.+_', regexp_extract(c.table_name, r'^meta_.+_(ads_insights|ad_creatives|ads|campaigns|ad_account|images|videos)$'), r'$'))
  ) as tables_in_stream
from `effen-growth-prod.raw`.INFORMATION_SCHEMA.COLUMNS c
where regexp_contains(table_name, r'^meta_.+_(ads_insights|ad_creatives|ads|campaigns|ad_account|images|videos)$')
  and column_name in (
    'image_hash', 'image_url', 'thumbnail_url', 'video_id', 'object_type',
    'object_story_spec', 'asset_feed_spec', 'effective_object_story_id',
    'object_story_id', 'body', 'title', 'name', 'status', 'call_to_action_type',
    'link_url', 'image_crops', 'platform_customizations', 'degrees_of_freedom_spec',
    'creative', 'attribution_setting', 'objective', 'timezone_name',
    'timezone_offset_hours_utc', 'currency', 'hash', 'url', 'permalink_url',
    'width', 'height', 'original_width', 'original_height', 'created_time',
    'updated_time', '_airbyte_extracted_at')
group by 1, 2
order by 1, 2;

-- ---------------------------------------------------------------------
-- Build session temp tables from every per-account table via TO_JSON.
-- ---------------------------------------------------------------------
declare creative_sql string;
declare ads_sql string;
declare insights_sql string;
declare account_sql string;

set creative_sql = (
  select string_agg(format(
    "select '%s' as src, to_json(t) as j from `effen-growth-prod.raw.%s` t",
    table_name, table_name), ' union all ')
  from `effen-growth-prod.raw`.INFORMATION_SCHEMA.TABLES
  where regexp_contains(table_name, r'^meta_.+_ad_creatives$'));
set ads_sql = (
  select string_agg(format(
    "select '%s' as src, to_json(t) as j from `effen-growth-prod.raw.%s` t",
    table_name, table_name), ' union all ')
  from `effen-growth-prod.raw`.INFORMATION_SCHEMA.TABLES
  where regexp_contains(table_name, r'^meta_.+_ads$'));
set insights_sql = (
  select string_agg(format(
    "select '%s' as src, to_json(t) as j from `effen-growth-prod.raw.%s` t where t.date_start >= date_sub(current_date(), interval 90 day)",
    table_name, table_name), ' union all ')
  from `effen-growth-prod.raw`.INFORMATION_SCHEMA.TABLES
  where regexp_contains(table_name, r'^meta_.+_ads_insights$'));
set account_sql = (
  select string_agg(format(
    "select '%s' as src, to_json(t) as j from `effen-growth-prod.raw.%s` t",
    table_name, table_name), ' union all ')
  from `effen-growth-prod.raw`.INFORMATION_SCHEMA.TABLES
  where regexp_contains(table_name, r'^meta_.+_ad_account$'));

-- A JSON-typed column arrives as an object; a STRING column carrying JSON
-- arrives as a string. jx() reads a path either way.
create temp function jx(j json, col string, path string) as (
  coalesce(
    json_value(j[col], path),
    json_value(safe.parse_json(json_value(j[col])), path)
  )
);
create temp function jq(j json, col string, path string) as (
  coalesce(
    json_query(j[col], path),
    json_query(safe.parse_json(json_value(j[col])), path)
  )
);

execute immediate format("create temp table raw_creatives as %s", creative_sql);
execute immediate format("create temp table raw_ads as %s", ads_sql);
execute immediate format("create temp table raw_insights as %s", insights_sql);
execute immediate format("create temp table raw_accounts as %s", coalesce(account_sql, "select '' as src, json '{}' as j limit 0"));

create temp table creatives as
select
  src,
  json_value(j.id) as creative_id,
  json_value(j.object_type) as object_type,
  coalesce(json_value(j.image_hash),
    jx(j, 'object_story_spec', '$.link_data.image_hash'),
    jx(j, 'object_story_spec', '$.photo_data.image_hash')) as image_hash,
  json_value(j.image_url) as image_url,
  json_value(j.thumbnail_url) as thumbnail_url,
  coalesce(json_value(j.video_id), jx(j, 'object_story_spec', '$.video_data.video_id')) as video_id,
  array_length(json_query_array(jq(j, 'object_story_spec', '$.link_data.child_attachments'))) as child_attachments,
  coalesce(to_json_string(jq(j, 'asset_feed_spec', '$')), 'null') not in ('null', '{}') as has_asset_feed,
  array_length(json_query_array(jq(j, 'asset_feed_spec', '$.images'))) as feed_images,
  array_length(json_query_array(jq(j, 'asset_feed_spec', '$.videos'))) as feed_videos,
  coalesce(json_value(j.body), jx(j, 'object_story_spec', '$.link_data.message')) as body,
  coalesce(json_value(j.title), jx(j, 'object_story_spec', '$.link_data.name')) as headline,
  json_value(j.effective_object_story_id) as effective_object_story_id,
  coalesce(to_json_string(jq(j, 'object_story_spec', '$')), 'null') not in ('null', '{}') as has_story_spec
from raw_creatives;

create temp table creatives_classified as
select
  *,
  case
    when has_asset_feed then 'dynamic'
    when coalesce(child_attachments, 0) > 0 then 'carousel'
    when video_id is not null or object_type = 'VIDEO' then 'video'
    when image_hash is not null then 'single_image'
    when not has_story_spec and effective_object_story_id is not null then 'existing_post'
    else 'unknown'
  end as creative_format
from creatives;

-- ---------------------------------------------------------------------
-- Q2 format mix and fill rates
-- ---------------------------------------------------------------------
select
  creative_format,
  count(*) as creatives,
  countif(image_hash is not null) as with_image_hash,
  countif(image_url is not null) as with_image_url,
  countif(thumbnail_url is not null) as with_thumbnail_url,
  countif(video_id is not null) as with_video_id,
  countif(body is not null) as with_body,
  countif(headline is not null) as with_headline,
  count(distinct src) as account_tables
from creatives_classified
group by creative_format
order by creatives desc;

-- ---------------------------------------------------------------------
-- Q3 spend coverage (last 90 days, latest extraction per ad × day)
-- ---------------------------------------------------------------------
create temp table insights as
select * except (rn) from (
  select
    json_value(j.ad_id) as ad_id,
    json_value(j.account_id) as account_id,
    json_value(j.account_currency) as currency_code,
    cast(json_value(j.date_start) as date) as date,
    safe_cast(json_value(j.spend) as numeric) as spend,
    json_value(j.attribution_setting) as attribution_setting,
    row_number() over (
      partition by json_value(j.ad_id), json_value(j.date_start)
      order by json_value(j._airbyte_extracted_at) desc) as rn
  from raw_insights)
where rn = 1;

create temp table ads as
select
  json_value(j.id) as ad_id,
  coalesce(json_value(j.creative.id), json_value(safe.parse_json(json_value(j.creative)), '$.id')) as creative_id,
  src
from raw_ads;

select
  case
    when a.ad_id is null then 'ad_not_in_catalog'
    when c.creative_id is null then 'creative_not_in_catalog'
    else c.creative_format
  end as binding,
  count(distinct i.ad_id) as ads,
  sum(i.spend) as spend_90d_mixed_currency,      -- shares only; do not sum across currencies for money
  round(100 * sum(i.spend) / sum(sum(i.spend)) over (), 2) as spend_share_pct,
  count(distinct i.currency_code) as currencies
from insights i
left join (select distinct ad_id, creative_id from ads) a using (ad_id)
left join (select distinct creative_id, creative_format from creatives_classified) c using (creative_id)
group by 1
order by spend_share_pct desc;

-- ---------------------------------------------------------------------
-- Q4 cardinality probes (each must be 0 rows for a fan-out-free join)
-- ---------------------------------------------------------------------
select 'ad_id appears with >1 creative_id' as probe, count(*) as violations
from (select ad_id from ads group by ad_id having count(distinct creative_id) > 1)
union all
select 'ad_id appears in >1 account table', count(*)
from (select ad_id from ads group by ad_id having count(distinct src) > 1)
union all
select 'creative_id classified >1 way', count(*)
from (select creative_id from creatives_classified group by creative_id having count(distinct creative_format) > 1)
union all
select 'creative_id with >1 image_hash', count(*)
from (select creative_id from creatives_classified group by creative_id having count(distinct image_hash) > 1);

-- ---------------------------------------------------------------------
-- Q5 attribution settings and account timezones actually present
-- ---------------------------------------------------------------------
select 'attribution_setting' as field, coalesce(attribution_setting, '(null)') as value,
       count(*) as ad_days
from insights group by 1, 2
union all
select 'account_timezone', coalesce(json_value(j.timezone_name), '(null)'), count(*)
from raw_accounts group by 1, 2
order by field, ad_days desc;

-- ---------------------------------------------------------------------
-- Q6 the proof row: one ad → exactly one image, with its fetchable URL.
-- image_url is a signed Meta CDN URL that expires; the archiver fetches
-- it once, hashes the bytes (SHA-256) and writes gs://…/sha256/<hash>.
-- ---------------------------------------------------------------------
select
  i.ad_id,
  a.creative_id,
  c.image_hash,
  c.image_url,
  sum(i.spend) as spend_90d,
  any_value(i.currency_code) as currency_code,
  any_value(k.creatives_per_ad) as creatives_per_ad   -- must be 1
from insights i
join (select distinct ad_id, creative_id from ads) a using (ad_id)
join (select ad_id, count(distinct creative_id) as creatives_per_ad from ads group by ad_id) k using (ad_id)
join creatives_classified c using (creative_id)
where c.creative_format = 'single_image'
group by i.ad_id, a.creative_id, c.image_hash, c.image_url
order by spend_90d desc
limit 5;
