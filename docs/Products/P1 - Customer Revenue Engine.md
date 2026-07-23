---
title: P1 - Customer Revenue Engine
description: Product requirements for Fullkit lifecycle CRM, customer service and omnichannel Conversation Hub.
created: 2026-07-16
updated: 2026-07-16
status: proposed
tags: [fullkit, p1, lifecycle, crm, retention, ltv, customer-service, conversation]
---

# P1 — Customer Revenue Engine

Parent portfolio: [[Fullkit Product Portfolio PRD]]. Technical placement: [[Fullkit Technical Architecture]]. Infrastructure: [[S1 - Customer and Order Hub]] and [[S4 - Money]]. Related bounded product: [[AI Sales Closer]].

> [!summary] Product decision
> P1 combines two coordinated modules—**Lifecycle CRM** and the **Conversation Hub**—because both manage customer contact policy and history. The [[AI Sales Closer]] remains a separate product because it owns a higher-risk, conversion-specific opportunity workflow.

## Product thesis

The CDP tells Fullkit **who the customer is and what has happened**. P1 decides **what customer interaction should happen next, through which channel, and who or what should handle it**.

P1 creates retained customer value across the full relationship:

**lead → first purchase → fulfilment → product success → feedback → repeat purchase → loyalty → risk → win-back**

Its goal is not message volume. Its goal is higher contribution LTV, faster service, fewer avoidable contacts and more trusted customer relationships.

## Product modules

| Module | Mode | Owns | Typical examples |
|---|---|---|---|
| **Lifecycle CRM** | Proactive, event/segment/time-driven | Journeys, steps, enrollment, eligibility, holdouts, contact policy and conversion attribution | Welcome, post-purchase education, replenishment, cross-sell, win-back |
| **Conversation Hub** | Reactive, real-time, thread-driven | Conversations, messages, intents, routing, SLA, ownership, service cases and human takeover | Order status, FAQ, complaint, feedback, social/WhatsApp reply |
| **AI Sales Closer** | Goal-directed conversion | Opportunity, requirements, objections, recommendations, cart/checkout steps and sales handoff | WhatsApp ad lead → qualified sale |

### CDP versus lifecycle versus auto-reply

| Question | Owner |
|---|---|
| Who is this person and what is their history/LTV/retention state? | S1 + BigQuery/RudderStack Customer 360 |
| Is this person eligible to receive a particular proactive contact now? | P1 Lifecycle CRM |
| What does this person need in this inbound conversation? | P1 Conversation Hub |
| Should we recommend an offer and advance toward a new order? | AI Sales Closer |
| Is the order/payment/shipment factually confirmed? | S1/S4/P4 authoritative APIs |

## Users and jobs

| User | Job to be done |
|---|---|
| Customer-service agent | Answer from one customer/order context, manage handoffs and resolve exceptions |
| Lifecycle marketer | Design, test and measure journeys without exporting customer lists manually |
| Sales closer | Continue qualified sales opportunities with complete context and clear limits |
| Brand manager | Set brand-specific tone, contact policy, offers and escalation rules |
| Growth operator | Plan retention contribution, diagnose cohort performance and allocate lifecycle effort |
| Compliance/operations owner | Audit consent, suppression, claims, message delivery and human ownership |

## Scope

### Lifecycle CRM

- Vendor-neutral journey definitions and versions
- Event-, segment-, date- and metric-triggered enrollment
- Entry/exit eligibility, consent, suppression and frequency caps
- Branches, delays, goals, holdouts and experiment assignments
- Template/channel bindings and dispatch requests
- Delivery, engagement, conversion and incremental-outcome ingestion
- Customer tasks for calls/manual follow-up
- Marketer planning calendar and journey performance

### Conversation Hub

- WhatsApp, Messenger, Instagram, TikTok and future channel adapters
- Durable webhook ingestion and normalized message model
- Cross-channel identity linkage to S1
- Unified inbox, assignment, priority and SLA
- Intent classification and approved FAQ/knowledge retrieval
- Deterministic transactional auto-replies where possible
- AI-assisted response drafting and bounded auto-reply
- Human handoff/takeover and bot pause/resume
- Service cases, feedback, complaints and resolution outcomes
- Delivery/read/failure reconciliation

### Customer profile surface

P1 reads a freshness-labelled customer context assembled from:

- S1 identity, consent, order and shipment records;
- S4 payment/refund and contribution facts;
- BigQuery/RudderStack lifecycle state, cohorts and governed traits;
- P1 journey, message, conversation and case history;
- approved knowledge and brand policy versions.

P1 does not recreate these source facts in a second CRM profile database.

## Lifecycle campaign map

| Lifecycle stage | Campaign/workflow | Trigger | Primary success signal |
|---|---|---|---|
| Lead/pre-purchase | Welcome/nurture | Consent or lead capture | Qualified visit/conversation/first order |
| Browse/intent | Browse or product-interest follow-up | Governed behavior plus eligibility | Return to product or conversation |
| Checkout | Abandoned checkout/cart | Checkout started without accepted order | Completed order, holdout-adjusted |
| Order | Confirmation and receipt | Order accepted/payment event | Delivered message; reduced inquiry |
| Fulfilment | Packing/shipping/tracking/status exception | S1/P4 shipment events | Self-service resolution; lower WISMO contacts |
| Delivery | Delivered/failed/COD recovery | Courier event | Successful delivery/recovery |
| Product success | Onboarding, usage and education | Delivered + product rules | Product engagement, lower complaint/return |
| Feedback | Feedback, CSAT/NPS or review request | Eligibility after delivery/resolution | Response, usable feedback, qualified review |
| Service recovery | Complaint/negative feedback workflow | Case severity or sentiment | Resolution and restored satisfaction |
| Replenishment | Expected reorder window | Product cadence + stock + eligibility | Repeat contribution/order |
| Cross-sell | Next-best compatible product | Customer/product state + offer policy | Incremental contribution, not raw clicks |
| Loyalty/VIP | Recognition, early access, loyalty benefit | Contribution/LTV tier | Retention and incremental value |
| At-risk | Churn-risk intervention | Declining lifecycle state | Reactivation versus holdout |
| Win-back | Lapsed customer sequence | Days since purchase + eligibility | Reactivation contribution |
| Dormant/sunset | Frequency reduction/suppression | No engagement or policy threshold | Better deliverability, opt-out risk reduction |

Transactional messages and marketing messages must remain distinct for consent, template, reporting and frequency rules.

## Standalone versus stitched

### P1 owns

- Journey design/runtime state and customer contact decisions
- Conversation/message normalization, service assignment and SLA state
- Customer-service cases and feedback workflow
- Vendor-neutral dispatch and outcome identifiers
- P1-specific templates, knowledge bindings and experiments

### Shared contracts it consumes

- S1: customer, identifiers, consent facts, orders, shipments and customer merge events
- S4: payments, refunds and governed value/contribution fields
- S3: availability/replenishment constraints
- Growth Engine: lifecycle targets, approved offers and experiment plans
- AI Sales Closer: opportunity status, handoff and verified sales outcome

### Vendor boundary

Channel and journey vendors may execute transport/workflows initially, but must not become Fullkit's only record of customer state, eligibility, journey identity or outcome.

## Build-versus-buy recommendation

### Recommended Phase 1 hybrid

| Layer | Recommended owner | Rationale |
|---|---|---|
| Customer/order/consent truth | Fullkit S1 | Strategic, cross-channel and required by every product |
| Governed profile/LTV/retention traits | BigQuery + RudderStack | Warehouse-native identity and activation backbone |
| Lifecycle journey builder and email delivery | **Customer.io** initially | Event-driven, composable lifecycle workflows; official RudderStack destination |
| Live WhatsApp/social inbox and routing | **respond.io** initially | Omnichannel inbox, human assignment, workflows, APIs/webhooks and official n8n integration |
| Integration glue and exception workflows | **n8n** internally | Useful adapter/orchestration surface; not customer/journey source of truth |
| Fullkit journey control/measurement | Build incrementally | Preserves portability, contact policy and differentiated decisioning |

This creates a clean operating split:

```text
Customer.io = lifecycle journey execution and email delivery
respond.io   = live conversations and human/AI routing
Fullkit      = identity, consent, eligibility, orders, policy and outcomes
```

Customer.io documents that its inbound WhatsApp capability is not a replacement for immediate conversational chat. That reinforces the split between lifecycle orchestration and the Conversation Hub. See [Customer.io Journeys](https://customer.io/platform/journeys), its [workflow builder](https://docs.customer.io/journeys/send/workflows/builder/), and [WhatsApp inbound limitation](https://docs.customer.io/journeys/channels/whatsapp/inbound/get-started/).

RudderStack lists official destinations for [Customer.io](https://www.rudderstack.com/integration/customer-io/), [Klaviyo](https://www.rudderstack.com/integration/klaviyo/) and [Mautic](https://www.rudderstack.com/integration/mautic/), and supports [BigQuery](https://www.rudderstack.com/integration/google-bigquery/) plus warehouse activation through [Reverse ETL](https://www.rudderstack.com/product/reverse-etl/).

### Alternatives

| Option | Best when | Trade-off |
|---|---|---|
| **Klaviyo** | Fastest commerce-native retention rollout and prebuilt ecommerce flows matter most | Strong capability but more CDP overlap and vendor gravity; keep Fullkit authoritative |
| **Mautic** | Self-hosting, source control and data sovereignty justify operations ownership | Cron/queue/deliverability/upgrades/security become EFFEN's responsibility |
| **GetResponse** | Already adopted and simple campaign breadth is sufficient | Broad marketing suite, but weaker natural fit with the RudderStack/warehouse architecture |
| **Build everything** | Only after repeated strategic need and scale are proven | Deliverability, editor UX, channel rules and runtime reliability are a large non-differentiating first build |

> [!note] Similar names, different products
> **respond.io** is the omnichannel conversation/inbox candidate. **GetResponse** is the email/marketing-automation suite. They solve different parts of the stack and should not be evaluated as interchangeable vendors.

Useful official references: [Klaviyo flows](https://help.klaviyo.com/hc/en-us/articles/115002774932), [Mautic campaign builder](https://docs.mautic.org/en/7.0/campaigns/campaign_builder.html), [Mautic cron requirements](https://docs.mautic.org/en/4.x/configuration/cron_jobs.html), [GetResponse automation](https://www.getresponse.com/help/what-is-marketing-automation-and-what-can-i-do-with-it.html) and [GetResponse API](https://apidocs.getresponse.com/v3).

### Why n8n is glue, not the lifecycle core

n8n is excellent for connector prototypes, alerts, manual approvals, low-risk back-office automation and vendor synchronization. It should not own canonical journey enrollment, consent, suppression, payment/order state or high-volume delivery. Its queue mode still requires Postgres, Redis, workers and operations ownership. Its Sustainable Use License also limits white-labelling or exposing n8n as a paid customer-facing product without an embed/commercial agreement. See [n8n queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/) and its [Sustainable Use License](https://docs.n8n.io/sustainable-use-license/).

## Channel ownership rule

Only one live transport owner should control a given channel/account/number at a time.

- Customer.io: email, push and lifecycle orchestration.
- respond.io: WhatsApp and live social conversations.
- Fullkit: permission, consent, frequency cap, order truth and command authorization.

If Customer.io needs a WhatsApp conversational step, it should request it through Fullkit's Messaging Command API and the respond.io/channel adapter rather than independently sending from the same number. This avoids split history, duplicate replies and competing automation.

respond.io does not currently claim Shopee or Lazada as supported messaging channels; marketplace orders and messages require their own approved platform connectors. See [respond.io channel limitations](https://respond.io/help/quick-start/connecting-channels).

## Operational schema

`lifecycle` and `conversation` below are logical P1 ownership namespaces. The MVP may use prefixed `app` tables per [[Fullkit Technical Architecture]]; canonical S1 customer, consent, conversation, message and service-case records remain in their existing shared tables.

### Outbound-message record boundary

| Contact type | Canonical request/history |
|---|---|
| Order/payment/shipment transactional notification | S1 `app.notification_jobs`, attempts and delivery events |
| Proactive lifecycle/marketing contact | `lifecycle.dispatch_requests`, attempts and delivery events |
| Reply inside a live customer thread | S1 `app.messages` plus provider delivery events, authorized through the Conversation Hub |

All three use the shared messaging/channel adapter and policy checks, but they retain distinct purpose and reporting. A provider receipt references the originating Fullkit request/message ID; it must not create a second customer-contact record.

### Lifecycle namespace

| Table | Grain and important fields |
|---|---|
| `lifecycle.journey_definitions` | One logical journey: purpose, owner, brand/market scope, status |
| `lifecycle.journey_versions` | One immutable version: trigger, exit, goal, policy and published time |
| `lifecycle.journey_steps` | One versioned node: type, position, conditions, delay, channel/template binding |
| `lifecycle.journey_edges` | One allowed transition/branch between steps |
| `lifecycle.journey_enrollments` | One customer × journey occurrence: entry reason, version, state, entered/exited time |
| `lifecycle.journey_step_runs` | One enrollment × step attempt: scheduled/start/end, decision, status, error |
| `lifecycle.eligibility_decisions` | One evaluated contact/action: consent, suppression, frequency, offer and reason evidence |
| `lifecycle.audience_snapshots` | One materialized audience/version with metric freshness and lineage |
| `lifecycle.holdout_assignments` | One stable customer/test assignment with method and expiry |
| `lifecycle.template_bindings` | Internal template key/version ↔ provider template/version/channel |
| `lifecycle.dispatch_requests` | One requested message/task with Fullkit ID, idempotency, schedule and policy version |
| `lifecycle.dispatch_attempts` | One vendor/channel attempt with provider ID and response |
| `lifecycle.delivery_events` | Sent/delivered/read/clicked/bounced/failed/unsubscribed with provider event time |
| `lifecycle.conversion_events` | Goal event linked to enrollment/dispatch with attribution method/window |
| `lifecycle.vendor_bindings` | Journey/customer/message references at the execution vendor |
| `lifecycle.frequency_counters` | Customer × channel/purpose/window contact counts and next eligible time |

### Conversation records and P1 workflow state

The shared customer-facing thread is canonical S1 infrastructure, not a second P1 CRM store. P1 reads and commands these S1 records described in [[S1 - Customer and Order Hub]]:

| Canonical S1 record | Role in P1 |
|---|---|
| `app.conversations` / `app.conversation_participants` | Channel-neutral thread and participants |
| `app.messages` / `app.message_delivery_events` | Immutable normalized messages and provider receipts |
| `app.conversation_assignments` | Shared queue/member ownership history |
| `app.service_cases` | Shared issue record linked to customer, conversation and order |
| `private.webhook_events` / `app.notification_jobs` | Durable provider intake and authorized transactional dispatch |

P1 owns only service/lifecycle workflow state that enriches those canonical IDs:

| P1 table | Grain and important fields |
|---|---|
| `conversation.channel_capability_snapshots` | One channel account/version: permitted message types, windows and feature/access state |
| `conversation.service_windows` | One customer/channel window state, such as WhatsApp's current free-form reply eligibility |
| `conversation.control_state` | One conversation's current bot/human owner, pause time, resume eligibility and policy version |
| `conversation.handoff_events` | One bot/human ownership transition with reason and platform reference |
| `conversation.intents` | One classified intent assertion with method, confidence and reviewer |
| `conversation.case_events` | Append-only workflow state/actions referencing `app.service_cases` |
| `conversation.feedback_records` | One structured feedback/review/CSAT observation with customer/order/product links |
| `conversation.sla_policies` | Versioned response/resolution thresholds by brand, channel and intent |
| `conversation.message_policy_decisions` | One consent/window/template/frequency/ownership decision for a proposed outbound message |
| `conversation.knowledge_bindings` | Approved knowledge/policy version allowed for a brand, channel and intent |

Canonical identity, conversation/message history, service-case identity and customer consent remain in S1. P1 may maintain derived suppressions, policy decisions and frequency eligibility, but it cannot overwrite a revoked canonical consent or duplicate an S1 message/thread.

## BigQuery marts

| Model | Grain/purpose |
|---|---|
| `fct_lifecycle_enrollment` | Enrollment × journey version; entry/exit/goal and state |
| `fct_lifecycle_message` | Dispatch × customer/channel; delivery, engagement, cost and conversion window |
| `fct_lifecycle_incrementality` | Experiment/holdout × cohort; lift and uncertainty |
| `fct_customer_lifecycle_state_daily` | Customer × date; state, recency, eligibility and risk |
| `fct_conversation` | Conversation; channel, intent, ownership, resolution and conversion |
| `fct_conversation_sla` | Conversation/assignment; first response, waits, breaches and resolution time |
| `fct_service_case` | Case; category, severity, outcome, refund/return and recovery |
| `fct_feedback_theme` | Product/brand/time/theme; structured feedback frequency and severity |
| `fct_retention_cohort` | Acquisition/reorder cohort with repeat and contribution LTV |

Message clicks or last-touch conversions are not automatically incremental. Journey reports must distinguish observed, attributed and holdout-estimated outcomes.

## APIs and events

### Customer context reads

- `GET /customers/{id}/service-context`
- `GET /customers/{id}/lifecycle-context`
- `GET /orders/{id}/status-summary`
- `GET /customers/{id}/communication-eligibility`

### Lifecycle commands

- `POST /journeys/{id}/publish`
- `POST /journeys/{id}/enrollments`
- `POST /journey-enrollments/{id}/pause|resume|exit`
- `POST /messaging/dispatch-requests`
- `POST /feedback-requests`

### Conversation commands

- `POST /conversations/{id}/messages`
- `POST /conversations/{id}/assignments`
- `POST /conversations/{id}/handoffs`
- `POST /conversations/{id}/cases`
- `POST /cases/{id}/resolve`

### Events consumed

- Customer identified/merged; consent granted/revoked
- Checkout started; order confirmed/cancelled
- Payment collected/failed/refunded
- Order packed/shipped/delivered/rejected/returned
- Product back in stock; replenishment eligibility changed
- AI closer opportunity/handoff/outcome

### Events emitted

- `journey_enrolled`, `journey_exited`, `journey_goal_reached`
- `message_dispatch_authorized`, `message_sent`, `message_delivered`, `message_failed`
- `conversation_started`, `conversation_assigned`, `conversation_handed_off`, `conversation_resolved`
- `service_case_opened`, `service_case_escalated`, `service_case_resolved`
- `feedback_received`, `customer_contact_suppressed`

## AI boundary

P1 AI may classify intent, retrieve approved FAQ/product/order context, summarize a thread, draft a reply, recommend routing and execute low-risk replies within policy.

It may not:

- claim payment, stock, shipment or refund state without a live authoritative tool result;
- approve refunds, discounts or medical/product claims outside policy;
- continue sending when a human owns the thread;
- contact an ineligible/suppressed customer;
- use raw warehouse access during a live conversation;
- silently move a service conversation into a sales opportunity.

Sales intent can create or update an [[AI Sales Closer]] opportunity. The closer then uses its own policy, state, evaluations and tools while the Conversation Hub remains transport/inbox owner.

## KPIs

### Customer value

- Repeat-purchase rate and time to second order
- Net and contribution LTV by cohort
- Replenishment, cross-sell and win-back incremental lift
- Retention contribution versus contact/channel cost

### Service

- First response, first meaningful response and resolution time
- SLA breach, reopen and escalation rates
- Self-service/automation containment with customer-satisfaction guardrail
- Order-status contact rate per 1,000 orders
- Complaint recovery and avoidable refund/return rate

### Contact quality

- Consent/suppression compliance
- Opt-out, complaint, bounce and delivery failure rates
- Frequency-cap violations and duplicate-send rate
- Human takeover correctness and bot-after-handoff violations

### System learning

- Journey holdout coverage and measured lift confidence
- Conversation intent accuracy
- Feedback themes converted into product/creative/operations actions
- Customer context freshness and lookup completeness

## MVP sequence

### Stage 0 — Instrument and centralize

- Establish S1 identity, consent and event contracts.
- Ingest current email/WhatsApp/social delivery and conversation evidence.
- Create vendor-neutral journey/message/conversation identifiers.
- Unified read-only Customer 360/service context.

### Stage 1 — Hybrid lifecycle and inbox

- Customer.io for lifecycle/email; respond.io for live conversations.
- Fullkit eligibility gate, dispatch ID and outcome ingestion.
- Transactional order/shipping templates, FAQ and human assignment.
- Basic welcome, post-purchase, feedback, replenishment and win-back journeys.

### Stage 2 — Fullkit control plane

- Own journey catalog/version metadata, consent/frequency decisions, holdouts and cross-channel command gateway.
- Customer.io continues workflow rendering/delivery; respond.io continues inbox/transport.
- Governed lifecycle contribution and service-performance marts.

### Stage 3 — Bounded AI

- Auto-reply for deterministic order status and approved FAQ cases.
- AI assistance and low-risk containment with evaluation gates.
- AI Sales Closer pilot receives qualified sales conversations.

### Stage 4 — Selective ownership

- Build a Fullkit marketer canvas/execution engine only if vendor cost/control/logic limits are repeatedly material.
- Continue buying channel delivery and compliance infrastructure.

## Risks and dependencies

1. Consent and cross-brand customer visibility need legal/policy decisions.
2. One channel/account cannot safely have competing transport owners.
3. Vendor webhooks can be late, duplicated or out of order; ingestion must be idempotent and timestamp-aware.
4. Lifecycle conversion reports can overclaim causal lift without holdouts.
5. Marketplace inbox coverage differs from social channels and requires separate APIs.
6. Building the visual editor too early would distract from identity, eligibility and outcome truth.
7. Human staffing/SLA ownership must be defined; automation cannot resolve organizational ambiguity.
8. Product and medical claims require approved knowledge and escalation policies.
9. WhatsApp Business Solution Data has source-specific profile-use restrictions under the March 2026 terms. Do not activate it as a general CDP feature merely because it was received by a webhook; apply purpose tags, minimization and legal/Meta review.

## Definition of done for MVP

- One customer profile shows canonical identity, orders, consent, lifecycle contacts and conversation history with freshness.
- Welcome, post-purchase, feedback, replenishment and win-back journeys execute through vendor-neutral Fullkit IDs.
- Every dispatch passes consent, suppression and frequency checks.
- Inbound WhatsApp/social messages enter one queue with clear bot/human ownership.
- Order-status auto-replies use live S1/P4 status, not model memory.
- Sales intent can hand off to the AI Sales Closer without losing the conversation or customer/order link.
- Delivery, engagement, service and sales outcomes land in BigQuery for governed evaluation.
