{#- Auto-discovery union over per-account Meta tables.

    Each Airbyte connection lands raw.meta_<account_key>_<stream>
    (unique prefixes are required by Airbyte's stream-uniqueness rule).
    This macro finds every matching table in the raw dataset at run
    time and unions an explicit column list — a new account's tables
    are picked up on the next run with zero dbt changes.

    The regex requires an account key between meta_ and the stream
    name, which deliberately EXCLUDES the orphaned single-source-era
    tables (raw.meta_ads_insights etc.) — including those would
    double-count the #5 Azman account. -#}
{% macro union_meta_stream(stream, column_sql) %}
  {%- if execute -%}
    {%- set discover -%}
      select table_name
      from `effen-growth-prod.raw`.INFORMATION_SCHEMA.TABLES
      where regexp_contains(table_name, r'^meta_.+_{{ stream }}$')
      order by table_name
    {%- endset -%}
    {%- set tables = run_query(discover).columns[0].values() -%}
    {%- if tables | length == 0 -%}
      {{ exceptions.raise_compiler_error(
        "union_meta_stream: no raw.meta_*_" ~ stream ~ " tables exist yet — has any per-account Airbyte sync completed?") }}
    {%- endif -%}
    {%- for t in tables %}
    select {{ column_sql }} from `effen-growth-prod.raw.{{ t }}`
    {%- if not loop.last %}
    union all
    {%- endif -%}
    {%- endfor %}
  {%- else -%}
    select {{ column_sql }} from `effen-growth-prod.raw.placeholder`
  {%- endif -%}
{% endmacro %}
