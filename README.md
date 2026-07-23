# effen-os

Internal operating system for **EFFEN International Sdn Bhd**. First deliverable: **Fullkit**, the commerce operations command centre.

```
apps/web    Fullkit — Next.js frontend prototype (synthetic data, no env vars needed)
docs/       Product plans and reference material (PRD, Schema Blueprint, Technical
            Architecture, Growth Engine, Spines, Products, research inputs)
```

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000 → redirects to /command-center
```

No environment variables are required — the prototype runs entirely on a seeded,
deterministic synthetic dataset (`apps/web/src/lib/seed`). The demo clock is fixed
at **23 Jul 2026, 09:00 MYT** so every relative timestamp and the Command Centre
briefing stay true.

## What Fullkit is

Not a generic analytics dashboard and not a Fighter clone. Every screen answers:
*what needs attention now, why, who owns it, and what should happen next.*

- **Command Centre** — morning briefing composed from live state, attention strip,
  commercial scorecard, plan-vs-actual, work queue, Prophit recommendations, data trust.
- **Orders** — dense operational table with saved views; six order states
  (order / payment / fulfilment / shipment / notification / return) always kept
  separate; order detail with a full evidence timeline; three-step order wizard with
  an "AI extraction — review required" paste-chat panel.
- **Customers** — privacy-masked Customer 360 with resolved identity, consent,
  value metrics, and provenance.
- **Marketing** — consolidated Meta/Google/TikTok view with an explicit
  attribution-is-not-incrementality caveat, campaign explorer, and a simulated
  OAuth connect-account wizard (write scopes gated behind separate approval).
- **Prophit** — a decision chain (target → expectation → actual → variance →
  diagnosis → recommendation → approval → action → outcome), imported read-side
  from the Growth Engine. Approving a recommendation ripples through the app.
- **Catalog, Reports, Integrations, Data Health** — governed metric definitions,
  source lineage, freshness SLAs, reason-coded sync history, and an owned issue queue.
- A labeled **demo role switcher** (HQ Admin, Sales/CS, Marketing/Growth,
  Operations, Finance, Analyst) demonstrates least-privilege navigation, fields,
  and actions.

## Architecture

- Next.js App Router + TypeScript + Tailwind v4 + shadcn/ui + Recharts + Zustand.
- Typed domain models (`lib/domain`) mirror the Schema Blueprint in `docs/`.
- All reads/writes go through a **Repository** interface (`lib/repo`):
  `MockRepository` (default, in-memory store) and a prepared `SupabaseRepository`
  adapter that activates only when `NEXT_PUBLIC_FULLKIT_REPO=supabase` **and**
  Supabase env vars exist — absence of configuration can never break the app.
  No service-role key ever ships to the browser.
- Seed invariants are asserted at store creation (4 pending decisions, 2 stale
  sources, yesterday below plan): `cd apps/web && pnpm check:seed`.

## State disciplines

Demo / Shadow / Live operating mode, brand, market, store, channel, currency,
source, owner, and data freshness are exposed on every relevant surface. The
prototype is Demo-only: actions mutate prototype state and are audited, but no
live system is connected and the UI never claims otherwise.
