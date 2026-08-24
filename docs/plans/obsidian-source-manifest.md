---
title: Obsidian source manifest
description: Which vault documents were synchronized into the repository on 25 Aug 2026, their checksums, the repository baseline they were compared against, and which repository document owns each requirement.
created: 2026-08-25
updated: 2026-08-25
status: living
tags: [fullkit, plans, obsidian, docs-sync, manifest]
---

# Obsidian source manifest

The Fullkit product notes are authored in the Obsidian vault and mirrored into `docs/`. This manifest records the exact vault state that the repository documentation and the [[operational-workspaces-customer-profit|program plan]] were synchronized from, so a later reader can tell whether the vault has moved on.

## Source directory

- Windows: `C:\Users\Nadeem\Desktop\Obsidian\build-blog\build-vault\5. Idea Vault\1. Internal Application\Fullkit - Commerce Backend Infrastructure`
- WSL: `/mnt/c/Users/Nadeem/Desktop/Obsidian/build-blog/build-vault/5. Idea Vault/1. Internal Application/Fullkit - Commerce Backend Infrastructure`

## Repository baseline inspected

- Commit `20fc870` — *Double sidebar: section rail + secondary nav for Orders, Customers, Fulfilment* (25 Aug 2026), on `main`.
- Working branch for the program: `codex/fullkit-customer-profit-program`.
- Supabase project `effen-os` (`wwgtjjekhehaepbxyrij`), 70 recorded migrations at the baseline (`20260824170953_order_queue_counts_v2` latest).

## Selected source documents

Modified times are the vault file's local time (UTC+08:00). SHA-256 is over the vault file bytes at synchronization.

| # | Document | Modified | SHA-256 | Repository disposition |
|---|---|---|---|---|
| 1 | `Operational Workspaces, Customer Base and Profit Metrics Plan.md` | 2026-08-25 02:09:55 | `93d3afc4c27b4e27d994e0de952974d6ddf139b5dcb0e708b5c3e64f3ae8d553` | Not copied — translated into the program plan; link stub in `docs/plans/` |
| 2 | `Order Intake, Fulfilment and CRM Automation Plan.md` | 2026-08-25 02:12:49 | `ec97b81ba0b558e3f8292e69be880b8775c08ee45580691e30c797b336d66629` | Not copied — translated (Phases 4, 6); link stub |
| 3 | `Production, Inventory and Marketplace Integration Plan.md` | 2026-08-25 01:52:01 | `b1414c2bb6c5eaf0e27b2f769187675101cd8e107dc0ad2dd5750e3e830a0ec7` | Not copied — translated (Phase 7); link stub |
| 4 | `Fullkit Frontend UI UX Plan and Fable Prompt.md` | 2026-08-25 02:21:31 | `aeab483baa15bfbe95505a93b222959b879a30ba103ebf163f011ad4da29bc2f` | Synced to `docs/`; status kept `historical-plan`; §12 one-shot prompt marked historical |
| 5 | `Products/P1 - Customer Revenue Engine.md` | 2026-08-25 02:10:41 | `3bc3a33a35cc70d9f30b15984638a38be1fbab531b832a008b442cb91356e64b` | Synced |
| 6 | `Products/P3 - Marketing Execution and Commerce Experience.md` | 2026-08-25 02:13:16 | `9f90f2d5e23ab33f611790e8a33dc218e647e9a2f7393008f6c685e72737358b` | Synced |
| 7 | `Products/P4 - Commerce Operations and WMS.md` | 2026-08-25 02:12:51 | `514412d61e355b5ae87055551ff7df687443ffcac59a2b14d47679645b00dac8` | Synced |
| 8 | `Products/P5 - Production Planning and MRP.md` | 2026-08-25 01:33:40 | `5a07d50ece7aedd7133e2025368f53234b4721c7bb536139de06cb3ac5cfc3ff` | Synced |
| 9 | `Products/P6 - Finance Control.md` | 2026-08-25 02:11:18 | `421c814439a64afb2ec603b7488dcd08ad51c4b1b2be67640d485263a160060a` | Synced |
| 10 | `Spines/S1 - Customer and Order Hub.md` | 2026-08-25 02:10:59 | `54a7572a21c8fc5d754ac4ca2f0e9eed24bad6a8b55cf5173cecb207d75968bf` | Synced |
| 11 | `Spines/S3 - Inventory.md` | 2026-08-25 01:33:41 | `96726f4672bfa2a80c02daf48913793501fed164d68b820aea89715e9ef2bbbf` | Synced |
| 12 | `Spines/S4 - Money.md` | 2026-07-16 07:57:17 | `1358312fe57f24b05d1f68364d0df90a33187e9464197637a2f0ab728879cc48` | Unchanged since July; repo copy identical. **Not refreshed by the 25 Aug addenda** — see conflicts |
| 13 | `Fullkit Schema Blueprint.md` | 2026-08-25 02:12:04 | `5967cad6b432f217752e6f8d9df31984975fa53bbaa0a3fb09e2db193af8978b` | Synced; status kept `reference-blueprint` (applied migrations stay authoritative) |
| 14 | `Growth Engine.md` | 2026-08-25 02:11:37 | `a21d37ff97a44d5b1c625776806c1115dc2f7b3a73e5ed7025d163fd231a782c` | Synced |
| 15 | `Fullkit Product Portfolio PRD.md` | 2026-08-25 02:12:15 | `ceff68b1efde669bbc7efc1cecfb231696e43caaa231363446280938f4086bcb` | Synced |

Vault documents not selected (`PRD.md`, `Fullkit Technical Architecture.md`, `Products/P2`, `AI Sales Closer`, `Iteratus`, `Spines/S2`, `Reference/`) were left as they are in the repository.

Sync mechanics: vault files are copied byte-for-byte except CRLF → LF (the repository convention). Wikilinks to the three non-copied plans resolve through the stubs in `docs/plans/`; the vault's link to its own driver prompt was redirected to the program plan.

## Requirement ownership

Each requirement family has exactly one owning repository document. Other documents link to it rather than restating it.

| Requirement family | Owning repository document | Notes |
|---|---|---|
| Program scope, phase order, current-vs-target matrix, acceptance tests, unresolved decisions | `docs/plans/operational-workspaces-customer-profit.md` | Translates sources 1–3 |
| What is live / hybrid / shadow / demo / placeholder today | `docs/CURRENT_STATE.md` | Code-backed only; never a target |
| Customer lifecycle policy, snapshot, transition, movement, acquisition-cohort and economics mart contracts | `docs/Fullkit Schema Blueprint.md` §"Customer lifecycle movement contract" | Program plan cites it; naming conflicts listed there |
| Lifecycle/cohort behaviour, consent, suppression, frequency, dispatch records | `docs/Products/P1 - Customer Revenue Engine.md` | |
| Profit customer-economics definitions (nCAC, LTV, FOP, payback, coverage gates) | `docs/Products/P6 - Finance Control.md` §5.7 with `docs/Spines/S4 - Money.md` metric contracts | S4 lacks the 25 Aug additions — the plan records the gap |
| Order QC, six state dimensions, reservation/release events, WMS boundary | `docs/Products/P4 - Commerce Operations and WMS.md` and `docs/Spines/S1 - Customer and Order Hub.md` | `qc_state` enum recorded in the program plan |
| Two-factory production, pack configuration, item types, stock authority | `docs/Products/P5 - Production Planning and MRP.md` and `docs/Spines/S3 - Inventory.md` | |
| Marketplace access, partner track, cutover modes | ADR-0009 and `docs/ops/marketplace-onboarding-plan.md` | |
| Courier write gate, shadow pilot exit criteria | ADR-0006 (and draft ADR-0002) | |
| Customer classification rules that are live today | ADR-0005 and ADR-0007 | Program plan lists their hard-coded thresholds |
| Information architecture (shipped shell, per-section destinations) | `apps/web/src/lib/nav/routes.ts` (code) and `docs/Fullkit Frontend UI UX Plan and Fable Prompt.md` §15 | Route registry is the truth for what exists |
| Growth Engine metric hierarchy, incrementality, automation levels | `docs/Growth Engine.md` | Status `concept-development`; formulas need ratification before encoding |

## Conflicts between sources recorded at synchronization

These are not resolved by this manifest; the program plan carries them as owner decisions.

1. `contribution_ltv` (Schema Blueprint: net revenue less COGS, payment fees, fulfilment costs, shipping subsidies) and `contribution_margin` (S4: additionally marketplace fees, commission, other approved variable costs) use different cost sets.
2. Mart naming differs between documents (`customer_lifecycle_state_daily` vs `fct_customer_lifecycle_state_daily`); `customer_lifecycle_eligibility` exists only in S1; `dim_customer_growth_state` / `fct_customer_cohort` exist only in Growth Engine.
3. `retained active`, `net active change` and `net active customer rate` are defined only in source 1; the Blueprint's movement identity carries a `corrections` term, so `net active change ≠ new + reactivated − lapsed` whenever corrections are non-zero.
4. "First delivered order" (acquisition cohort) rests on the completed/collected revenue definition that S1 and S4 both list as an open decision, and both state that delivery is not automatically completion.
5. S4 was not refreshed on 25 Aug: it has no acquisition-spend-allocation, nCAC, FOP or payback contract even though those are S4-domain metrics.
6. Program phase numbers (Phase 1–7) collide with product document numbers (P1–P6) and spine numbers (S1–S4). The plan always says "Phase n" for program phases.

## Re-synchronization rule

Recompute the SHA-256 of each selected document before the next sync. If a hash differs, diff the vault file against the repository copy, update the owning document, update the program plan's requirement table, and record the new hash here. Never copy the whole vault; never let a synced target document be read as release status.
