---
title: Fighter Teardown
description: Architecture and feature teardown of FIGHTER (fighter.com.my) — the sistem-ejen OMS EFFEN already uses for one brand. Research input for the Fullkit PRD.
created: 2026-07-10
tags: [reference, teardown, fullkit, oms, fighter, malaysia-ecommerce]
---

# FIGHTER (fighter.com.my) — Product Teardown

> Researched 2026-07-10 from the live site, onboard flow, app/API probes. Feeds [[5. Idea Vault/2. Application/B2C/Active/Twinagent - Monitoring and steering AI agent works/PRD|the Fullkit PRD]]. **EFFEN already runs one brand's orders in Fighter** — this teardown doubles as an audit map of what we're renting today.

First-party tenant evidence and the live discovery checklist are captured in [[Fighter Walkthrough - WordPress Integration and HQ Dashboard]] and [[Fighter Walkthrough - Order Operations and Integrations]].

## 1. What the product is

**FIGHTER** is a Malaysian B2B SaaS: a **multi-channel OMS built for the "sistem ejen" distribution model** — HQ brands selling through tiered networks of **Leader → Stokis → Agent → Dropship** plus in-house sales teams. HQ fulfils, commissions flow up the tree.

- **Tagline**: "Managing Leader, Stokis, Agent, Dropship & Sales Team Was Never So Easy Before"
- **Operator**: Fighter Network Sdn Bhd (1447879-K), Cyberjaya. WhatsApp-first sales.
- **Team (public)**: Aziz Ahamed (CEO), Nazmul Hasan (CTO), Nur Shafiqah Athirah (CFO) — small team.
- **Traction counters**: 470 businesses, 18,454 users, 5,807 products, 6.6M orders (self-reported; the "RM 1.23 trillion" counter is a display bug — treat all as soft).
- **Origin signal**: grew out of running its own dropship program (daftarfighter.com / EPM Nation), then productized the tooling.
- **App**: `fighter.my` (login-only, v2.27.0); API facade at `api.fighter.my` (same version → same Laravel codebase). No public docs/help subdomains.
- Not a storefront builder — assumes selling happens via WhatsApp/social/agents/external stores; Fighter is the back office.

## 2. Feature inventory (module names verbatim from pricing matrix)

### Core feature grid

| Feature | Description |
|---|---|
| Order Management | Multi-channel order tracking, automated processing |
| Product Variations & Inventory | Per-variation inventory |
| Dual Invoice | Invoice for both seller (agent) and end customer |
| AWB Manager | Integrated couriers; instant AWB + delivery note |
| Dynamic Coupon | Coupons gated to eligible sellers/roles |
| Order Notification | Email/WhatsApp/SMS to seller AND customer on status change |
| Multitier Commissions | From seller links, recruitment, or network |
| Multi-level User Roles | Custom roles + positions controlling pricing & commission tiers |
| Role Automation | Auto upgrade/downgrade roles on seller KPI |
| Realtime User Ranking | Leaderboards by role/orders/sales/points/date range |
| Statistics & Exports | Order stats + export for auditing |
| Multi-Channel Order Sync | Realtime WooCommerce; also Shoppegram, Shopify, OnPay, sales pages |

### Full module list (by domain)

- **Ordering**: Make Order, Bulk Orders, Quick Entry, Express Process, Duplicate Order Checker, Fraud Checker
- **Fulfilment**: AWB Manager, AWB Options, **AWB Option By Brand** (custom logo + sender name per brand), Delivery Note, Dynamic Pickup Locations, Shipping Automation, Shipping Discount, Cloud Print, Product Label (Barcode/QR)
- **Money/wallet**: Wallets, Wallet Reload (Billplz & CHIP), Wallet-to-Wallet Transfer, Billplz Payment Order (**mass payout to agents**), Payment Protection, **Payment Collection By Brand** (separate collection ID per brand)
- **Pricing/promo**: Dynamic Pricing, Dynamic Discount, Dynamic Coupon, Cart Discount, Cart Adjustment, Product Restriction, Brand Rule & Restrictions
- **Commissions**: 6 types — Sales, Recruitment, Channel, Network, Point, Same Level; Share Profits (R.O.I, R.O.A.S, Bonus, Allowance)
- **CRM/marketing**: Round CRM (lead rotation), **Claimify** (track ads cost, claims, any spending — feeds ROI/ROAS profit-share), Announcements, Activities
- **Users**: User Ranking, Role Automation, Easy Access
- **Reporting**: Reports & Statistics (Orders/Users/Wallets), Exports (7/14/31-day windows by tier)
- **Platform**: Autopilot (automation rules), AirHooks (webhooks "in FIGHTER way"), White Label + Custom Domain, API Integration (per-user key limits by tier)
- **Notifications**: Digest (daily→yearly), **Notification By Seller** (agents BYO WhatsApp/SMS providers), **Notification By Brand** (separate WhatsApp numbers/SMS per brand)

### Integrations

- **Couriers (9)**: Ninja Van, POS Malaysia, DHL eCommerce, SPX, Redly, J&T, Flash Express, City-Link, SkyNet; plus Self Pickup, 3 custom labels, "VIRTUAL" shipping
- **Payments (13)**: COD, Cash, Bank Transfer (manual w/ proof), CHIP, Billplz, WalletPay, ToyyibPay, Bizappay, SecurePay, senangPay, Atome (BNPL), Stripe, HitPay
- **WhatsApp**: official WABA + 5 unofficial providers (WasapBot, WaBot, Waapify, Wasapmetic, DaBox)
- **SMS**: SMS Niaga, AdaSMS
- **Store sync**: WooCommerce (realtime), Shopify, Shoppegram, OnPay, generic sales pages
- **3PL**: AFM Fulfillment
- **Gaps**: no marketplace sync (Shopee/Lazada/TikTok Shop); no storefront/funnel builder.

## 3. Inferred subsystem breakdown (build-list)

1. **Multi-tenant core** — tenant = HQ business; plan-gated limits; white-label/custom domain per tenant.
2. **Catalog service** — products, variations w/ per-variation stock, brands, vendors; barcode/QR labels; bulk import; **per-role price books**; product/brand restrictions.
3. **Order pipeline** — intake (manual/quick/bulk/API/sync), state machine, express fast path, duplicate + fraud checks (phone/address/COD history rules), dual-invoice PDFs.
4. **Network/hierarchy engine (the moat)** — user genealogy tree, custom roles/positions, KPI-driven role automation, realtime leaderboards.
5. **Commission engine** — multi-tier calc across 6 trigger types + profit sharing (ROI/ROAS/bonus/allowance), settling into wallets.
6. **Wallet/ledger** — per-user wallets, gateway reloads, transfers, **mass payout** (Billplz Payment Order), payment protection, per-brand collection accounts. A closed-loop ledger with money-in/out adapters.
7. **Payments abstraction** — 10+ MY gateway adapters + COD/manual transfer with proof-verification workflow.
8. **Shipping subsystem** — 9 courier adapters, AWB/delivery notes, pickup locations, automation rules, per-brand AWB branding, Cloud Print, custom-label fallback.
9. **Notification subsystem** — template + event driven; email/SMS/WhatsApp adapters; BYO provider per seller and per brand; scheduled digests.
10. **Promotions engine** — role-gated coupons, cart discount/adjustment, shipping discount.
11. **Channel sync connectors** — WooCommerce webhooks, Shopify, Shoppegram, OnPay, form intake; two-way inventory/order sync.
12. **CRM + ad-spend tracking** — Round CRM (lead round-robin to agents), Claimify (expense/ad-cost ledger feeding profit-share).
13. **Automation platform** — Autopilot rules + AirHooks + public REST API.
14. **Reporting/BI** — dashboards + tier-gated CSV exports.
15. **Billing/subscription** — self-serve onboarding (collects SSM number), promo codes + referral field.

## 4. Tech stack signals

- **Backend: Laravel (PHP) monolith** — high confidence (`fighter_session` + Laravel-encrypted XSRF cookies, csrf-token meta, Laravel Mix asset conventions, Nunito default font). API facade is the same codebase.
- **Infra**: Apache 2.4.53/Ubuntu; marketing site behind Cloudflare (KUL). No SPA framework; server-rendered Bootstrap ("Sandbox" theme).
- **Money rails**: CHIP + Billplz are first-class (wallet reload + mass payout); CHIP affiliate link on homepage.

## 5. Business model & pricing

Subscription SaaS, monthly, self-serve, WhatsApp-assisted. **Two conflicting live price lists:**

- Homepage: **Starter RM0** / **Prime RM499** / **Infinity RM999** (discounted from RM999/1,999/2,999 anchors)
- Onboard form (newer): **Starter FREE / Pro RM699 / Plus RM999 / Enterprise RM1,199 / Freedom RM1,999**

All tiers: **unlimited orders/sales/customers/storage** — the monetization axis is **seller count, role depth, and module gating** (they charge on the size of your agent network, not order volume). Permanent free tier as funnel; referral acquisition motion.

## 6. Market context

Crowded BM "sistem ejen" niche: **Bizapp** (biggest, 700k+ users claimed; owns Bizappay which Fighter integrates — coopetition), **Firesell**, **Ejen2u**, **WeNiaga**, **EjenKu**, **OnPay** (also a Fighter channel). Adjacent: EasyStore/SiteGiant/Shoppegram (storefront + marketplace sync), Sellercraft (marketplace OMS), Kumoten (dropship supplier marketplace), Boostorder (B2B wholesale).

**Fighter's differentiation**: depth of commission engine (6 types + ROI/ROAS profit share), built-in wallet with mass payout, **per-brand white-labeling under one HQ** (separate AWB branding, payment collection, WhatsApp numbers), fraud/duplicate COD checks, unlimited-order pricing. **Weaknesses**: no marketplace sync, no storefront, thin docs/community.

## EFFEN-specific notes

- Consolidated-context meta-gap #6 stands confirmed: Fighter already does courier integration, notification triggers (by brand!), exports, duplicate/fraud checks — **audit what's switched on before building anything** (Pack 3 Q3).
- Per-brand features (AWB By Brand, Payment Collection By Brand, Notification By Brand) mirror exactly what a 5-brand HQ needs — this is the feature set Fullkit's multi-brand core must match.
- Export windows are tier-gated (7/14/31 days) — a structural ceiling on our data maturity while ordering data lives only in Fighter. Continuous ingestion (API/exports) is the workaround, and a core Fullkit motivation.

## Sources

fighter.com.my · fighter.com.my/onboard · fighter.my/login · api.fighter.my · ZoomInfo (Fighter Network Sdn Bhd) · daftarfighter.com (cache) · bizapp.com.my · firesell.my · weniaga.com · ejenku.com · ejen2u.com · kumoten.com · sellercraft.co
