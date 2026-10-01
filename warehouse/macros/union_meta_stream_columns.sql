{#- Drift-tolerant variant of union_meta_stream (ADR-0010).

    union_meta_stream unions an explicit column list and fails the whole
    model if one per-account table lacks a column. The creative-media
    models read fields Airbyte only materialises once a stream has seen
    them (image_hash, video_id, asset_feed_spec ...), so a column present
    in one account table may be absent in another.

    `required` columns must exist in every table (a missing one raises a
    compiler error naming the table). `optional` columns are selected
    where present and emitted as a typed NULL elsewhere, with the type
    taken from the first table that has the column (STRING if none do).
    A per-row `_source_table` is added so lineage survives the union.

    Same discovery regex as union_meta_stream: orphaned single-source
    tables (raw.meta_<stream>) stay excluded. -#}
{% macro union_meta_stream_columns(stream, required, optional=[]) %}
  {%- if execute -%}
    {%- set discover -%}
      select table_name, column_name, data_type
      from `effen-growth-prod.raw`.INFORMATION_SCHEMA.COLUMNS
      where regexp_contains(table_name, r'^meta_.+_{{ stream }}$')
      order by table_name, ordinal_position
    {%- endset -%}
    {%- set rows = run_query(discover).rows -%}
    {%- set tables = [] -%}
    {%- set present = {} -%}
    {%- set types = {} -%}
    {%- for r in rows -%}
      {%- if r[0] not in tables -%}{%- do tables.append(r[0]) -%}{%- endif -%}
      {%- do present.update({r[0] ~ '.' ~ r[1]: true}) -%}
      {%- if r[1] not in types -%}{%- do types.update({r[1]: r[2]}) -%}{%- endif -%}
    {%- endfor -%}
    {%- if tables | length == 0 -%}
      {{ exceptions.raise_compiler_error(
        "union_meta_stream_columns: no raw.meta_*_" ~ stream ~ " tables exist yet") }}
    {%- endif -%}
    {%- for t in tables %}
    select
      {%- for c in required %}
      {%- if (t ~ '.' ~ c) not in present -%}
        {{ exceptions.raise_compiler_error(
          "union_meta_stream_columns: required column " ~ c ~ " missing from raw." ~ t) }}
      {%- endif %}
      {{ c }},
      {%- endfor %}
      {%- for c in optional %}
      {%- if (t ~ '.' ~ c) in present %}
      {{ c }},
      {%- else %}
      cast(null as {{ types.get(c, 'STRING') }}) as {{ c }},
      {%- endif %}
      {%- endfor %}
      '{{ t }}' as _source_table
    from `effen-growth-prod.raw.{{ t }}`
    {%- if not loop.last %}
    union all
    {%- endif -%}
    {%- endfor %}
  {%- else -%}
    select {{ (required + optional) | join(', ') }}, '' as _source_table
    from `effen-growth-prod.raw.placeholder`
  {%- endif -%}
{% endmacro %}
