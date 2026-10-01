-- Campaign objective for comparable-cohort ranking (ADR-0010). A sales
-- campaign and a traffic campaign are not compared on the same table.
{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}

with unioned as (
  {{ union_meta_stream_columns('campaigns',
      required=['id'],
      optional=['objective', 'buying_type', '_airbyte_extracted_at']) }}
)

select
  id as campaign_id,
  objective as campaign_objective,
  buying_type
from unioned
qualify row_number() over (
  partition by id
  order by _airbyte_extracted_at desc nulls last
) = 1
