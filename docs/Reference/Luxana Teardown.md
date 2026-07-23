---
title: Luxana Teardown
description: Architecture and feature teardown of Luxana (luxana.com.my) — agent/dropship OMS with COD revenue protection. Research input for the Fullkit PRD.
created: 2026-07-10
tags: [reference, teardown, fullkit, oms, malaysia-ecommerce]
---

# Luxana (luxana.com.my) — Product Teardown

> Researched 2026-07-10 from the live site, app shell, App Store/Play listings, and CTOS records. Feeds [[5. Idea Vault/2. Application/B2C/Active/Twinagent - Monitoring and steering AI agent works/PRD|the Fullkit PRD]].

## 1. What the product is

**Luxana** is a cloud-based **Order Management System (OMS) for Malaysian e-commerce sellers**, built around agent/dropship-team selling and COD-heavy fulfillment. Tagline: *"Order Management System that Motivates"* — positioning is emotional/gamified ("doesn't just track sales — it fuels them"). Name derives from Malay *"terlaksana"* (accomplished).

- **Company**: LUXANA TECHNOLOGIES (IP0611040V / 202503187690), incorporated **2025-07-09** (sole prop/enterprise, not Sdn Bhd), Cyberjaya. WhatsApp-first support.
- **Target customer**: Malaysian (also SG/BN) online sellers running multi-channel sales (TikTok Shop, Shopee, WooCommerce, Shopify, WhatsApp order-taking) with **agent/dropshipper teams** ("manage 5 agents or 500"), heavy COD, up to 3,000 parcels/day. Merchant logos are Malay-market brands. Copy mixes EN and BM.
- **Core value prop**: one queue for all channels → bulk-approve → print AWB → push to courier ("push 100 orders in 3 seconds"), plus revenue protection for COD (duplicate/failed-delivery/high-risk-buyer tooling), agent commission management, and dopamine-hit sales notifications on mobile.
- Self-reported traction: "80+ brands, RM 4.2M/mo processed" (unverified, <1 year old company).

## 2. Feature inventory

### Five core modules (every tenant gets all five)

1. **Orders** — unified order queue; status filters (New/Pending/In Transit/Completed/Rejected); bulk approve; bulk AWB generation/label printing; push to 8+ couriers; auto stock-check on landing orders; auto-flagging; per-customer order history inline (LTV, order count); payment-method tagging (COD/Bank); batch push (20/50/100 per push by tier); bulk push 2,000+ (Lux); **Batch Ship**, **Fast Ship** ("Lightning", Lux), **Auto Ship** (coming); background waybill processing.
2. **Notify** (Luxana Hub mobile app) — real-time "ka-ching" push per sale with amount, product, buyer, city, channel; live sales counter.
3. **Page** ("Laman" builder) — built-in order-form/landing-page builder for sellers without websites; public forms at `/forms/*` and short domain **lmn.je**; per-tier form limits; phone-number blocklists; reseller/recruit registration pages.
4. **Profit** — commission engine: order commissions, multiple commission types by tier; **Seller's Wallet** with cash-withdrawal flow.
5. **Reports** — live sales, delivery rates, retention, weekly trends; Order/Product/Seller reports; seller ranking/leaderboards; CSV export (32-day window).

### Revenue Protection Suite (Flex & Lux tiers) — the differentiator

- **COD Tracker** — courier COD payout/remittance reconciliation (automated on Lux)
- **Duplicate Alert** — cross-channel duplicate order grouping
- **Delivery Recovery** — failed-delivery detection + why + buyer follow-up to save the parcel from return
- **High-Risk Flag** — flags risky buyers pre-ship (e.g. "3 of 5 orders rejected/returned")
- **High-Value Track** — pins top-spending customers

### Team / agent hierarchy

Multi-level custom roles; hierarchy depth 2/10/25 by tier; seller caps 50/100/unlimited; per-tier product/variation/form/integration quotas; team invite flow.

### Messaging & notifications

- **Meta Official (WABA)** via **Meta Embedded Signup** in-app (FB SDK v22.0); automated order-status notifications; WABA order-taking (Flex+); auto follow-up; customer pays Meta conversation fees; paid setup-assist service.
- **Lux Notify** — managed WhatsApp sender from Luxana's own number; prepaid credits at **RM0.088/msg**.
- **Lux SMS**; **Wasapbot** (unofficial WhatsApp bot) integration; **Aftercare** (post-delivery messaging, Lux); **CRM follow-up** (Lux).

### AI & automation

- **AI Order Phraser / "Lux AI Paste"** (Flex+) — paste raw WhatsApp order text → AI extracts name/address/postcode/phone into a structured order (10–15s vs 1–2 min manual).
- **AI order assistance** (Lux); **Webhook** (Lux); **Custom API** (Flex+).

### Integrations

- **Sales channels (11)**: TikTok Shop, Shopee, WooCommerce, Shopify, Shoppego, Fluent Forms, OnPay, Convertly, LadiPage, bcl.my, Custom API. (No Lazada.)
- **Couriers (8 + 1 coming)**: Ninja Van, Ninja Cold, Pos Laju, J&T, SPX, DHL eCommerce, Aramex, Lalamove (soon). "All routes sync under 8s."
- **Mobile app** ("Luxana Hub", iOS+Android): live dashboard, order management, **POS** (cash/card/QR), tracking, offline mode with sync.

## 3. Inferred subsystem breakdown (build-list)

1. **Multi-tenant core** — tenant → role hierarchy → sellers/agents; per-tier quota enforcement; auth; onboarding wizard; invites.
2. **Channel ingestion layer** — marketplace/store connectors + webhook receivers; normalization to a unified order model; near-real-time sync; cross-channel dedup.
3. **Order management engine** — state machine, bulk-operation background job queue, stock-check hook, order creation (manual + AI paste + WABA).
4. **Fulfillment/courier layer** — 8 courier adapters (booking, AWB PDF, pickup, tracking webhooks); public tracking page; pickup-location config.
5. **COD & payments reconciliation** — remittance matching; failed-delivery event detection + recovery workflow.
6. **Risk engine** — buyer scoring from rejection/return history; duplicate grouping; high-value flagging.
7. **Page builder ("Laman")** — hosted order forms/LPs, short-domain serving, blocklists, checkout.
8. **Payment gateway integration** — Chip, Billplz, Stripe.
9. **Commission & wallet subsystem** — rules, per-order calc, ledger, withdrawal/payout (mini fintech ledger).
10. **Messaging subsystem** — WABA w/ Embedded Signup, templates, status-triggered rules; managed sender with prepaid metering; SMS; follow-up sequences (CRM-lite).
11. **AI service** — LLM unstructured-text → structured order parsing.
12. **Notifications/mobile** — push (FCM/APNs), realtime feed, offline-first mobile + POS.
13. **Analytics & reporting** — live dashboards, delivery/retention metrics, leaderboards, CSV pipeline.
14. **Extension surface** — outbound webhooks, inbound API.
15. **Support/ops** — Chatwoot live chat, help center, blog, referral tracking.

## 4. Tech stack signals (high confidence)

- **Marketing site**: Astro static + React islands, Tailwind-style CSS, GA4, five Meta Pixels, schema.org SoftwareApplication JSON-LD.
- **App (luxana.my)**: **React + Vite SPA** with **Supabase** (auth/Postgres/realtime), deployed on **Vercel** (region `sin1`).
- **Support**: self-hosted **Chatwoot** (support.luxana.my).
- **WhatsApp**: direct Meta WABA Embedded Signup (not a BSP reseller wrapper).
- **Gateways**: Chip, Billplz, Stripe.
- Small-team signals: solo-founder registration, <1yr old, copy typos, placeholder pixel IDs.

## 5. Business model

SaaS subscription, MYR monthly, anchor pricing, 7-day trial:

| Tier | Price | Headline gates |
|---|---|---|
| Essential | RM198/mo | basic OMS, 20/push, 50 sellers, 20 products, sales-only commissions |
| Flex | RM498/mo | + revenue protection suite, WABA orders, AI order phraser, Custom API, 100 sellers |
| Lux | RM998/mo | + Lightning ship, 2,000+ bulk push, webhook, aftercare, CRM, unlimited everything |

Plus usage revenue (Lux Notify RM0.088/msg), paid WABA setup, migration service, referral program. All plans sized to 3,000 parcels/day; Enterprise via WhatsApp.

## 6. Market context

- **Direct (agent/dropship OMS)**: Bizapp (incumbent), Fighter, OnPay (coopetition — also a channel), PayRecon Cloud Dropshipping.
- **Marketplace-sync OMS/ERP**: BigSeller (freemium, dominant), SiteGiant, EasyStore, Zetpy, Sellercraft, SmartB.
- **Positioning**: differentiates via agent-team selling + COD revenue protection + WhatsApp-native flow + gamification; modern UI + AI parsing + official WABA vs Bizapp/Fighter. Gaps: no Lazada, no accounting integrations.

## Sources

luxana.com.my · luxana.my app shell · Luxana blog/help · App Store (Luxana Hub, id6755590041) · Google Play (com.luxana.oms) · CTOS business record IP0611040V · SiteGiant Top-10 OMS 2026 · Founder HQ sistem-agent comparison · bizapp.com.my · payrecon.my · sellercraft.co · bigseller.com
