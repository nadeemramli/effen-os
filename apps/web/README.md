# Fullkit web application

Next.js frontend for Fullkit, EFFEN’s internal commerce operating system.

## Run locally

From the repository root:

```bash
corepack enable
pnpm install
pnpm dev
```

Or from this directory:

```bash
pnpm dev
```

The application opens at `http://localhost:3000` and redirects to `/command-center`.

## Demo and live behavior

The application deliberately supports both modes:

- **No environment variables:** deterministic demo state remains available for the shell and prototype modules. Live-only routes render a clear setup guard.
- **Supabase configured and authenticated:** live routes read the operational mirrors and governed RPCs behind RLS. Set the variables in `.env.example`, then sign in with an invited workspace account.

```bash
cp .env.example .env.local
```

Required public variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_FULLKIT_AUTH=required`

Only the Supabase publishable/anon key belongs in the browser. Never add a service-role key to a `NEXT_PUBLIC_*` variable.

Live pages use `src/lib/supabase/live.ts` directly. The generic `src/lib/repo/supabase.ts` adapter is still a prepared boundary, not the complete production backend; do not set `NEXT_PUBLIC_FULLKIT_REPO=supabase` expecting all older demo workflows to become live.

## Application areas

- Live or hybrid: Orders, Customers, Fulfilment, Automations, Marketing, Profit, Catalog, Inventory, Production, and live Setup.
- Seeded prototype: parts of Command Centre, Creative, Finance, Reports, Integrations, and Data Health.
- Placeholder: Audit and Settings.

The exact boundary and known gaps are maintained in [docs/CURRENT_STATE.md](../../docs/CURRENT_STATE.md).

## Checks

```bash
pnpm lint
pnpm build
pnpm check:seed
```

`check:seed` verifies deterministic demo invariants. `build` is the relevant end-to-end frontend compilation check.

## Key implementation paths

```text
src/app/(shell)/            Route surfaces
src/lib/supabase/live.ts    Live read/write client functions
src/lib/store/              Deterministic demo state
src/lib/rbac/               Role and permission matrix
src/lib/nav/routes.ts       Shared route registry
src/components/auth/        Authentication and live-route guards
```
