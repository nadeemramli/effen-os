-- Campaign catalog across all per-account tables (names feed the brand
-- waterfall's token matching).
{{ union_meta_stream('campaigns', 'id, account_id, name') }}
