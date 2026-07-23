---
title: P4 - Commerce Operations and WMS
description: Product requirements for Fullkit's role-based order command centre, fulfilment orchestration and optional owned warehouse-management workflows.
created: 2026-07-16
updated: 2026-07-16
status: proposed
tags: [fullkit, p4, operations, oms, wms, inventory, fulfilment]
---

# P4 - Commerce Operations and WMS

> [!summary] Product decision
> P4 is the light, role-based order-management surface used by sellers, customer service, operations and warehouse teams over the shared S1, S3 and S4 infrastructure. It does not create a duplicate order database. WMS capability may be owned or externally provided, but **exactly one system is the physical stock authority for each location**.

Portfolio context: [[Fullkit Product Portfolio PRD]]. Infrastructure context: [[PRD]], [[Fullkit Technical Architecture]], [[Fullkit Schema Blueprint]], [[S1 - Customer and Order Hub]], [[S3 - Inventory]] and [[S4 - Money]].

## 1. Thesis and users

All three conversion paths—conversation, owned website and marketplace—must converge on one confirmed-order contract, then move through a controlled fulfilment workflow. P4 gives each operating role the actions and context it needs while keeping order, stock and money authority in the shared spines.

Primary users:

- Sellers/closers creating or correcting conversation-assisted orders
- Customer-service agents reviewing customer, order and delivery context
- Operations staff validating and routing confirmed orders
- Warehouse pickers, packers and supervisors
- Returns and delivery-exception operators
- Finance users reviewing COD/payment/settlement blocks
- Operations managers monitoring SLA, capacity, stock accuracy and reconciliation

## 2. Standalone versus stitched boundary

P4 is a standalone workflow/UI product composed over authoritative services.

| Concern | Authority | P4 role |
|---|---|---|
| Customer and order | S1 Cloud SQL | Role-specific queues, validations and permissioned commands |
| Payment/COD/settlement flag | S4 | Display evidence and place/release fulfilment holds through approved commands |
| Available stock and reservation | S3 or contracted WMS | Request allocation/reservation and show confirmed result |
| Pick, pack, bin and stock movement | Owned P4 WMS or external WMS per location | Execute owned workflow or mirror/command through adapter |
| Shipment/tracking | S1 fulfilment/shipment contract plus courier adapter | Create labels, hand over parcels and manage delivery exceptions |
| Production requirement | P5 | Receive finished goods; never plan manufacturing inside WMS |
| Analytics | BigQuery governed marts | Operational dashboards and daily reconciliation |

If an external WMS is selected, Fullkit keeps canonical item/location mappings, commands it idempotently and mirrors its events. It must not maintain an independently editable “shadow on-hand” balance for the same location.

## 3. Scope

### Shared order command centre

- Confirmed-order intake from conversation, Woo/Fighter and marketplaces
- Role-based queues for new, review, hold, ready, fulfilment and exception states
- Customer, source, product, payment, address, conversation and risk context
- Assignment, notes, evidence, approval and audited correction
- Split fulfilment and location allocation
- Payment/COD/inventory/fraud/duplicate holds
- Daily order tally against Fighter, marketplaces and WMS during migration

### WMS capability

- Warehouse, zone and bin structure
- Stock receipt, putaway, on-hand balance and append-only movement ledger
- Reservation, allocation, wave, pick, pack, package and handover
- Transfers, stock-in, stock-out and controlled adjustments
- Stocktake and cycle-count workflows
- Return receipt, inspection and disposition
- Lot/batch and expiry tracking where products require it
- Courier label/tracking integration and delivery exception workflow

## 4. Non-goals

- A second customer/order/payment source of truth inside the P4 UI
- Manufacturing demand planning, BOM explosion or work-order scheduling; that is P5
- A general accounting ledger or finance close; that is P6/SQL Accounting
- Silently changing stock from spreadsheets, dashboards or AI suggestions
- Owning the marketplace storefront or courier network
- Supporting every enterprise WMS feature before the actual warehouse process is mapped
- Treating `order_confirmed`, `payment_collected`, `packed`, `shipped`, `delivered` and `completed` as one status

## 5. Complete workflow

### 5.1 Confirmed-order intake

1. S1 accepts an authenticated, idempotent order command/event from conversation, website, Fighter or marketplace.
2. Canonical product variants, source/store, customer identities, addresses, price/discount snapshots, payment/COD state and provenance are retained.
3. P4 receives `order_confirmed` and creates or updates a work item referencing the S1 order.
4. Policy evaluates duplicates, invalid mappings, address quality, stock, payment/COD, fraud and fulfilment route.
5. A clean order enters ready-to-allocate; an uncertain order enters a reason-coded exception queue.

### 5.2 Review and release

1. The assigned operator sees one composed view from S1, S3 and S4.
2. The operator corrects only fields allowed by role and order state; every change writes an order state/audit event.
3. Price, payment, cancellation and material address changes may require approval.
4. Release to fulfilment records the actor, policy version, evidence and chosen fulfilment location.
5. Retried actions use idempotency keys and cannot duplicate fulfilment or labels.

### 5.3 Allocation and reservation

1. P4 requests available-to-promise by variant and permitted location.
2. The stock authority atomically reserves quantities for order items.
3. Split allocation creates separate fulfilments when policy permits.
4. Failed or partial allocation becomes a shortage/backorder/substitution decision; P4 never invents stock.
5. Reservation expiry, cancellation or reallocation emits explicit movement/reservation events.

### 5.4 Receive and put away

1. An expected inbound receipt references supplier, transfer, return or P5 finished-goods receipt.
2. Warehouse staff count and identify items, lots/batches, expiry and condition.
3. Variances enter review before accepted stock changes.
4. Accepted stock creates append-only receipt movements and putaway tasks.
5. Putaway completion moves stock into an addressable bin and updates the authoritative balance.

### 5.5 Wave, pick, pack and handover

1. Eligible fulfilments are grouped into a wave using carrier cutoff, priority, location, item, risk and capacity rules.
2. Pick tasks direct the operator to bin, item, lot and quantity; scans confirm each step.
3. Short picks create an exception and stock verification task.
4. Pack verifies order contents, packaging, weight and shipping service.
5. Courier adapter creates one idempotent AWB/label; package and tracking references attach to S1 shipment records.
6. Handover records courier, manifest, scan, time and custody evidence.

### 5.6 Delivery, rejection and return-to-sender

1. Courier webhooks append shipment events and update the separate shipment state.
2. Delays, failed attempts, rejection or return-to-sender enter reason-coded queues.
3. CS/P1 receives the appropriate customer communication trigger.
4. Returned parcel receipt verifies contents and condition.
5. Disposition is restock, quarantine, refurbish, destroy, return-to-supplier or investigate.
6. Refund/claim/financial consequences are commands to S4/P6, not warehouse-side edits.

### 5.7 Stocktake and corrections

1. A stocktake or cycle-count session freezes or controls relevant movements by policy.
2. Blind counts are recorded per bin/item/lot and compared with expected balance.
3. Material variance requires recount and supervisor approval.
4. Approved adjustment writes an append-only movement with reason and evidence.
5. Inventory accuracy and unresolved variance are reported by location and item.

### 5.8 Daily tally and migration control

1. Compare source orders, S1 accepted orders, P4 work items, WMS fulfilments and courier handovers.
2. Reconcile status and count differences by source/location/day.
3. Every mismatch becomes an owned exception with source evidence and ageing.
4. A brand/location migrates from Fighter or another WMS only after sustained reconciliation passes and rollback is tested.

## 6. Operational schema proposal

P4 uses the canonical `customers`, `orders`, `order_items`, `order_state_events`, `payments`, `fulfillments`, `shipments`, `returns`, `inventory_locations`, `inventory_levels`, `inventory_reservations` and `inventory_movements` from [[Fullkit Schema Blueprint]]. It adds workflow state under the logical `operations` domain and, if Fullkit owns the warehouse runtime, detailed physical execution under logical `wms`. Per [[Fullkit Technical Architecture]], the MVP may implement both as prefixed `app` tables while retaining separate ownership and roles.

### Operations UI/workflow

| Table | Grain | Key fields |
|---|---|---|
| `operations.work_queues` | One configured role queue | `id`, `workspace_id`, `name`, `queue_type`, `role_scope`, `filter_definition`, `priority_rule`, `status` |
| `operations.work_items` | One object x active workflow reason | `id`, `queue_id`, `object_type`, `object_id`, `reason_code`, `priority`, `status`, `assigned_membership_id`, `due_at`, `correlation_id` |
| `operations.exception_cases` | One operational exception case | `id`, `case_type`, `order_id`, `fulfillment_id`, `shipment_id`, `inventory_ref`, `severity`, `evidence_refs`, `owner_id`, `status`, timestamps |
| `operations.case_actions` | One action/decision in a case | `id`, `exception_case_id`, `action_type`, `decision`, `reason_code`, `actor_id`, `before_ref`, `after_ref`, `occurred_at` |
| `operations.saved_views` | One member/team view configuration | `id`, `owner_type`, `owner_id`, `view_type`, `filters`, `columns`, `sort_order` |
| `operations.reconciliation_cases` | One source x business date x mismatch | `id`, `source_integration_id`, `business_date`, `object_type`, `mismatch_type`, `expected_ref`, `observed_ref`, `status`, `owner_id` |

`operations.work_items` are task references, not duplicated order snapshots. The P4 read model may cache non-authoritative display fields with source version/freshness, but commands always target the authoritative service.

### Owned WMS

| Table | Grain | Key fields |
|---|---|---|
| `wms.warehouses` | One physical warehouse | `id`, `inventory_location_id`, `code`, `name`, `timezone`, `stock_authority`, `status` |
| `wms.zones` | One warehouse zone | `id`, `warehouse_id`, `code`, `zone_type`, `priority`, `status` |
| `wms.bins` | One addressable storage bin | `id`, `zone_id`, `code`, `bin_type`, `capacity`, `pick_sequence`, `status` |
| `wms.lots` | One item lot/batch | `id`, `inventory_item_id`, `lot_code`, `manufactured_at`, `expires_at`, `supplier_or_batch_ref`, `status` |
| `wms.bin_balances` | One bin x item x lot balance | `bin_id`, `inventory_item_id`, `lot_id`, `on_hand_qty`, `reserved_qty`, `version`, `updated_at` |
| `wms.receipts` | One inbound receipt | `id`, `warehouse_id`, `source_type`, `source_ref`, `expected_at`, `status`, `received_by`, timestamps |
| `wms.receipt_lines` | One expected/received item line | `id`, `receipt_id`, `inventory_item_id`, `expected_qty`, `received_qty`, `accepted_qty`, `rejected_qty`, `lot_id`, `variance_reason` |
| `wms.putaway_tasks` | One receipt line x destination task | `id`, `receipt_line_id`, `from_bin_id`, `to_bin_id`, `quantity`, `status`, `assigned_to`, timestamps |
| `wms.fulfillment_waves` | One released group of fulfilments | `id`, `warehouse_id`, `wave_rule_version`, `cutoff_at`, `status`, `released_by`, timestamps |
| `wms.wave_fulfillments` | One wave x fulfilment | `wave_id`, `fulfillment_id`, `sequence` |
| `wms.pick_tasks` | One picker route/task | `id`, `wave_id`, `assigned_to`, `status`, `started_at`, `completed_at` |
| `wms.pick_task_lines` | One bin/item/lot requirement | `id`, `pick_task_id`, `fulfillment_item_ref`, `bin_id`, `inventory_item_id`, `lot_id`, `required_qty`, `picked_qty`, `exception_code` |
| `wms.pack_jobs` | One fulfilment packing job | `id`, `fulfillment_id`, `station_ref`, `assigned_to`, `status`, `verified_at` |
| `wms.packages` | One physical parcel | `id`, `pack_job_id`, `shipment_id`, `package_type`, `weight`, `dimensions`, `label_ref`, `status` |
| `wms.shipment_handovers` | One package/manifest custody handover | `id`, `warehouse_id`, `courier_integration_id`, `manifest_ref`, `package_id`, `scan_ref`, `handed_over_by`, `handed_over_at` |
| `wms.stocktake_sessions` | One count scope/event | `id`, `warehouse_id`, `scope`, `count_type`, `status`, `opened_by`, `closed_by`, timestamps |
| `wms.stocktake_counts` | One count attempt x bin/item/lot | `id`, `stocktake_session_id`, `bin_id`, `inventory_item_id`, `lot_id`, `attempt`, `counted_qty`, `counted_by`, `counted_at` |
| `wms.return_receipts` | One physical returned parcel receipt | `id`, `return_id`, `warehouse_id`, `package_ref`, `received_by`, `received_at`, `status` |
| `wms.return_inspections` | One return item inspection | `id`, `return_receipt_id`, `order_item_id`, `received_qty`, `condition_code`, `disposition`, `evidence_refs`, `approved_by` |

The target WMS model uses the generalized S3 `inventory_item_id` described in [[P5 - Production Planning and MRP]] so the warehouse can hold raw material, packaging, WIP and finished goods. During the initial sellable-variant phase, each inventory item maps one-to-one to `product_variant_id`. The detailed bin balance must reconcile to the S3 location balance. Transfers and adjustments use canonical S3 `app.inventory_transfers`, `app.inventory_adjustments` and `app.inventory_movements`; the WMS does not create second editable records for them. Every accepted receipt, pick, transfer, return or adjustment creates an append-only canonical movement; balances are projections with optimistic version control.

## 7. BigQuery marts

| Model | Grain | Purpose |
|---|---|---|
| `fct_order_flow_daily` | Date x source x brand x state transition | Order intake, queue and transition counts |
| `fct_order_exception` | Exception case | Type, ageing, owner, resolution and recurrence |
| `fct_fulfillment_cycle` | Fulfilment | Confirm-to-release-to-pick-to-pack-to-handover cycle time |
| `fct_inventory_movement` | Accepted inventory movement | Item, location, lot, source, reason and quantity |
| `fct_inventory_snapshot_daily` | Date x location/bin x item/lot | On-hand, reserved, available and ageing |
| `fct_stock_accuracy` | Stocktake x location/item | Expected, counted, variance and approval |
| `fct_wms_productivity` | Date x warehouse x operator/task type | Units, tasks, time, exceptions and rework |
| `fct_delivery_performance` | Shipment | Handover, attempts, delivered/RTS, SLA and courier |
| `fct_return_disposition` | Return item | Reason, condition, disposition, recovery and financial consequence |
| `fct_order_wms_reconciliation` | Date x source/location | S1 orders, WMS fulfilments, shipments and mismatch status |

## 8. APIs and events

### Core commands

- `POST /orders/{id}/assign`, `/approve`, `/hold`, `/release`, `/cancel`
- `POST /orders/{id}/fulfillments`
- `POST /inventory/reservations`, `/release`, `/reallocate`
- `POST /wms/receipts`, receive and accept-variance commands
- `POST /wms/putaway-tasks/{id}/complete`
- `POST /wms/waves`, release and assign commands
- `POST /wms/pick-tasks/{id}/scan` and complete/short-pick commands
- `POST /wms/pack-jobs/{id}/verify`
- `POST /shipments/labels` and handover commands
- `POST /wms/stock-transfers`
- `POST /wms/stocktakes` and count/approve-adjustment commands
- `POST /returns/{id}/receive` and disposition commands

### Read APIs

- Role-aware order/customer/payment/inventory/fulfilment composition
- Available-to-promise and reservation state
- Warehouse task queues and capacity
- Shipment/tracking timeline
- Stock ledger, balance and stocktake variance
- Source/S1/WMS/courier reconciliation

### Domain events

`order_routed_to_operations`, `order_hold_placed`, `order_released_to_fulfillment`, `inventory_reserved`, `inventory_reservation_failed`, `receipt_accepted`, `putaway_completed`, `fulfillment_wave_released`, `pick_completed`, `short_pick_detected`, `pack_completed`, `shipment_label_created`, `shipment_handed_over`, `delivery_exception_detected`, `return_received`, `return_disposition_approved`, `stocktake_variance_detected`, `inventory_adjustment_approved`, and `order_wms_mismatch_detected`.

## 9. AI boundary

AI may:

- Summarize an order/customer/stock/shipment case from curated APIs
- Prioritize queues and predict SLA or stockout risk
- Propose fulfilment location, wave grouping and pick route
- Detect duplicate, address, reconciliation and stock anomalies
- Draft customer/warehouse notes and recommended resolution

AI may not:

- Directly change canonical order, payment, shipment or stock rows
- Invent availability, confirm a pick or approve a stock adjustment without verified evidence
- Mark a payment collected or refund completed
- Cancel an order, issue an AWB, dispose a return or release a material hold outside policy/approval
- Query arbitrary warehouse tables or reveal cross-brand PII

AI uses allow-listed read and command APIs. Physical scans, payment/provider verification and named approvals remain authoritative. Recommendations retain evidence, model/policy version and outcome.

## 10. KPIs

### Order and fulfilment

- Confirmed-order intake coverage by source
- Confirmed-to-release, release-to-pick, pick-to-pack and pack-to-handover time
- Orders shipped before carrier cutoff and within SLA
- Order exception rate, ageing and time to resolution
- Perfect-order and wrong/missing-item rates

### Inventory and warehouse

- Inventory accuracy by location/item/lot
- Reservation success and oversell rate
- Pick accuracy, units/hour and rework
- Dock-to-stock and return-to-disposition time
- Stocktake variance, adjustment value and repeat variance
- Space/capacity utilization where data supports it

### Delivery and control

- First-attempt delivery, rejection and return-to-sender rate
- Courier SLA and tracking freshness
- Daily S1-to-WMS tally pass rate
- Percentage of mutations with actor, reason, evidence and idempotency
- Manual spreadsheet/copy-paste steps retired

## 11. Dependencies and risks

| Dependency/risk | Control |
|---|---|
| Unclear WMS build-versus-buy decision | Keep S3 contract stable; map actual warehouse process before selecting runtime |
| Two stock systems claim authority | Explicit `stock_authority` per location and no dual editable balances |
| Order state is collapsed into one label | Separate order/payment/fulfilment/shipment/notification/exception states |
| External WMS/courier retries duplicate work | Idempotent commands, external-ID uniqueness and execution receipts |
| Bad product/source mappings create phantom stock | Canonical variant mapping, quarantine queue and reconciliation |
| P4 UI caches stale authority | Source version/freshness display and command-time revalidation |
| Warehouse adoption fails | Scan-first minimal screens, role-based queues, training and parallel reconciliation |
| AI recommendation is treated as physical proof | Require scans/provider evidence and human approval for material mutations |
| Returns obscure financial impact | Explicit return disposition plus S4 refund/claim command |
| Cutover disrupts fulfilment | Brand/location phased strangler migration with tested rollback |

## 12. Staged MVP

### Stage 0 - Read-only command centre

- Compose S1 order, S3 stock, S4 payment and courier status.
- Add source/S1/Fighter/WMS daily reconciliation.
- Map roles, queues, states and actual exception reasons.

### Stage 1 - Controlled order operations

- Add assignment, notes, hold/release and fulfilment-location commands.
- Preserve separate state machines, audit and idempotency.
- Continue fulfilment in Fighter/external WMS while Fullkit shadows.

### Stage 2 - Narrow owned WMS or contracted adapter

- Decide authority per location.
- Deliver receipt, location/bin, reservation, pick, pack, handover and movement ledger for one brand/location—or integrate those exact contracts to the selected WMS.
- Require sustained balance and order reconciliation.

### Stage 3 - Returns, stocktake and multi-source depth

- Add cycle counts, stocktake, transfers, return inspection/disposition and delivery exceptions.
- Add split fulfilment and richer marketplace/courier adapters where justified.

### Stage 4 - Bounded optimization

- AI-assisted prioritization, wave/route suggestions and anomaly detection.
- Automatic low-risk task creation within approved policies.
- Physical and financial mutations remain evidence-backed and reversible.

## 13. MVP acceptance criteria

- Orders from conversation, website and marketplaces produce the same S1 contract and P4 workflow.
- P4 displays one S1 order; it does not maintain a duplicate editable order record.
- Every location has one declared physical stock authority.
- Every stock change traces to an append-only movement, actor/system, reason and source object.
- Label creation, reservation and external commands remain idempotent under retry.
- Daily S1/order/WMS/courier reconciliation exposes every mismatch with an owner.
- P4 can be used by seller, operations and warehouse roles without exposing actions outside their permissions.
