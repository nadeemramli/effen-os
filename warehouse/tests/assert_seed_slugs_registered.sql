-- Warn (not fail) when a seeded brand slug is not yet registered in
-- Fullkit's brands table — per the decision to seed first, register
-- later. Clears as brands get registered.
{{ config(severity = 'warn') }}

select a.brand_slug
from {{ ref('brand_aliases') }} a
left join {{ source('raw', 'supabase_brands') }} b on b.slug = a.brand_slug
where b.slug is null
group by a.brand_slug
