# effen-os

Internal operating system for **EFFEN International Sdn Bhd**. Its first application is **Fullkit**, a commerce operations command centre that is progressively replacing spreadsheet and SaaS workflows around the existing Fighter estate.

> **Current state — 19 Aug 2026:** Fullkit is a hybrid internal application. Several modules use live Supabase, WooCommerce, Ninja Van, and warehouse data; some workflows remain in shadow mode; older strategy and control surfaces still use deterministic demo data. See [Fullkit current development state](docs/CURRENT_STATE.md) for the code-backed status of every area.

## What is running today

- **Live commerce read side:** invite-only Supabase authentication, workspace roles, WooCommerce order mirrors, customer identity resolution, Customer 360, catalog and inventory views, market/brand scopes, and Ninja Van tracking.
- **Live controlled operations:** store/catalog setup, SKU mappings and governed costs, reusable customer segments and CSV export, shipping corrections and fulfilment holds, and a production ledger with inbound-material tracking. Sensitive actions are RLS- or RPC-guarded.
- **Live growth and contribution:** Meta data flows through Airbyte → BigQuery → dbt → Supabase; Marketing and Profit combine warehouse spend with Fullkit order truth, effective-dated cost rules, courier returns, CM2, and CM3.
- **Shadow fulfilment:** Fullkit grades ship readiness, drafts AI-assisted address corrections, and records the exact Ninja Van payload it would send. Real consignment creation remains off until the accepted shadow exit gate is met.
- **Demo or planned areas:** portions of Command Centre, Creative, Finance, Reports, Integrations, and Data Health still use seeded prototype state. Audit and Settings are placeholders. The UI labels and current-state document identify these boundaries.

## Repository map

```text
apps/web/                 Next.js 16 / React 19 Fullkit application
supabase/migrations/      Operational schema, RLS, RPCs, read models, and cron jobs
supabase/functions/       Woo, WhatsApp, Ninja Van, mart-sync, and AI edge functions
warehouse/                BigQuery dbt project for governed growth facts
infra/                    Terraform for the GCP growth-data platform
docs/                     Product plans, ADRs, operating notes, and current state
```

## Local development

Requirements: Node.js 20+, pnpm 11, and Corepack.

```bash
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:3000`; the root route redirects to `/command-center`.

With no environment variables, the shell and remaining prototype surfaces run on the deterministic seed in `apps/web/src/lib/seed`. Live-only pages show a configuration guard instead of inventing data.

To use live Supabase-backed surfaces:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in the Supabase project URL and publishable/anon key, keep `NEXT_PUBLIC_FULLKIT_AUTH=required`, and sign in with an invited workspace account. Browser code must never receive a service-role key.

Useful checks:

```bash
pnpm lint
pnpm build
pnpm --filter web check:seed
```

Warehouse changes under `warehouse/**` are compiled on pull requests and built/tested by the scheduled or manually dispatched dbt workflow.

## Enabling live auth

The prototype is open by default. Auth activates only when all of these are
set — absence of configuration can never break the app:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # publishable key; every table is behind RLS
NEXT_PUBLIC_FULLKIT_AUTH=required
```

If the Supabase project has **CAPTCHA protection** enabled (Auth > Bot and
Abuse Protection), one more is mandatory:

```bash
NEXT_PUBLIC_SUPABASE_CAPTCHA_SITEKEY=... # hCaptcha sitekey (public)
```

Without it GoTrue rejects every sign-in with *"captcha protection: request
disallowed (no captcha_token found)"* before it ever checks the password, so
the failure looks like a bad credential rather than missing config. The
paired secret is configured in Supabase, never here.

Two Auth policies shape the password screens, both read from the server and
neither visible to the client — if they are toggled, the UI must follow:

- **Secure password change** — `updateUser` must carry `current_password`, so
  the change-password dialog always collects it.
- **Leaked password protection** — a new password that appears in a known
  breach is rejected with a 422; the dialog surfaces that inline.

Access is invite-only: authenticating is not the same as being let in. A
membership exists only if `membership_invites` holds the email, so new
teammates need an invite row before their first sign-in.

## Operating boundaries

- The demo mode pill is still a presentation control for seeded surfaces; it does not authorize external writes.
- Live pages call the explicit Supabase client/read-model functions in `apps/web/src/lib/supabase/live.ts`. The older generic `Repository` adapter remains incomplete and should not be enabled as a blanket live backend.
- Fighter remains active for today’s pick/pack/handover workflow. Fullkit’s Ninja Van submission path is shadow-only for the current pilot.
- BigQuery/dbt is analytical truth; operational commands remain in Supabase/Postgres RPCs and edge functions.
- Business-day windows are evaluated in Asia/Kuala_Lumpur time.

## Documentation

- [Documentation map](docs/README.md) — how current state, ADRs, target plans, operating registers, and research fit together.
- [Current development state](docs/CURRENT_STATE.md) — shipped, shadow, demo, and planned scope.
- [Architecture decision records](docs/decisions/) — accepted implementation boundaries.
- [Product PRD](docs/PRD.md) — target product scope, not a release tracker.
- [Technical architecture](docs/Fullkit%20Technical%20Architecture.md) and [schema blueprint](docs/Fullkit%20Schema%20Blueprint.md) — target/reference designs; migrations and code are authoritative for the deployed system.
