-- RLS policies call private.is_workspace_member(); the calling role must be
-- able to resolve the function (schema USAGE + EXECUTE) even though the
-- function body runs as its owner (security definer). Without this, every
-- member-scoped policy fails with "permission denied for schema private".

grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(bigint) to authenticated;

-- Lock down what PUBLIC gets by default in this schema going forward.
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;
