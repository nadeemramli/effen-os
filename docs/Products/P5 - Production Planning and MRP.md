---
title: P5 - Production Planning and MRP
description: Product requirements for Fullkit demand-to-production planning, raw-material balance, BOMs, capacity, work orders, batches, yield and finished-goods receipt.
created: 2026-07-16
updated: 2026-07-16
status: proposed
tags: [fullkit, p5, production, mrp, manufacturing, inventory]
---

# P5 - Production Planning and MRP

> [!summary] Product decision
> P5 is the manufacturing planning and execution product. It decides **what, how much, how and when to make**. P4/WMS decides **where stock is and what physically moved**. P5 consumes approved demand and S3 balances, creates material and capacity plans, and returns verified finished goods to S3.

Portfolio context: [[Fullkit Product Portfolio PRD]]. Infrastructure context: [[PRD]], [[Fullkit Technical Architecture]], [[Fullkit Schema Blueprint]], [[S3 - Inventory]], [[P4 - Commerce Operations and WMS]] and [[Growth Engine]].

## 1. Thesis and users

Production should not forecast finished goods in one spreadsheet, raw materials in another and warehouse balances in a third. P5 creates a traceable chain from demand version to supply plan, BOM, material requirement, capacity commitment, work order, batch, yield, quality and finished-goods receipt.

Primary users:

- Production planner managing demand, supply and shortage exceptions
- Production manager approving and sequencing work orders
- Procurement operator acting on material shortage recommendations
- Warehouse team issuing materials and receiving finished goods through S3/P4
- Production operators recording operation, batch, yield and scrap
- Quality reviewer releasing or quarantining output
- Finance/costing reviewer analyzing standard and actual production cost
- Growth Operator seeing supply constraints before committing marketing demand

## 2. Standalone versus stitched boundary

P5 is a standalone planning/transaction product stitched to S3 inventory and the Growth Engine.

| Concern | P5 owns | Other authority |
|---|---|---|
| Demand for production | Frozen/planning demand snapshots and their use in a plan | Growth Engine owns approved commercial forecast; S1 owns actual orders |
| Product structure | Versioned BOM, routing, work center and manufacturing policy | S3 owns canonical item identity and physical balance |
| Plan | Planning runs, net requirements, planned supply and exceptions | Human planner approves commitments |
| Execution | Work order, operation, material requirement, production batch, yield/scrap and QC state | P4/S3 owns physical issue, return, movement and receipt |
| Cost | Standard/actual production evidence and variance | S4/P6 owns governed contribution and accounting export |
| Procurement | Purchase requisition/recommendation may be produced | Supplier contracting, AP and general procurement suite are outside initial scope |

P5 must never edit an on-hand quantity directly. Material issue, return, scrap and finished-goods receipt become explicit idempotent S3/WMS commands and confirmed inventory movements.

## 3. Scope

- Generalized inventory-item master for raw materials, packaging, WIP and finished goods
- Unit-of-measure definitions and controlled conversions
- Versioned bills of material and routings
- Work centers, shifts, calendars and effective capacity
- Demand snapshots from Growth Engine plus actual/backlog signals
- Raw-material balance and time-phased MRP
- Supply plans, planned orders and shortage/action messages
- Production forecast and capacity-loading scenarios
- Approved work orders and operation schedule
- Material reservation, issue and return through S3/P4
- Batch/lot, yield, scrap, rework and quality control
- Finished-goods receipt and release/quarantine through S3/P4
- Production cost snapshots and plan-versus-actual learning

## 4. Non-goals

- Replacing P4/WMS bin, pick, pack, transfer or stocktake workflow
- A full supplier-management, purchasing, AP or accounting suite in MVP
- Advanced finite scheduling before routings, calendars and actual cycle time are trustworthy
- Automatic production commitments from an unapproved statistical forecast
- Editing historical BOM, routing or cost versions after use
- Treating all raw materials and finished goods as `product_variants` without an extensible item model
- Letting AI release materials, approve QC or receive finished goods without operational evidence

## 5. Complete workflow

### 5.1 Item, UOM and manufacturing master

1. S3 assigns every stocked item a stable identity and type: raw material, packaging, WIP, finished good, consumable or other.
2. Base UOM and permitted conversions are defined with precision and rounding rules.
3. A finished good receives a versioned BOM and routing with effective dates.
4. Changes create new versions and approval; open work orders retain the version snapshot they were released with.
5. Lot, shelf-life, quality and traceability policies attach to the item.

### 5.2 Demand intake and planning run

1. Growth Engine publishes an approved demand version by brand/product/market/period with scenario and confidence.
2. P5 snapshots forecast demand, actual orders/backlog, safety stock, open supply, usable on-hand, reserved/quarantined stock and lead times.
3. The planner selects planning horizon, time bucket, policy and allowed substitutions.
4. MRP nets demand against available and scheduled supply, then explodes BOM requirements by effective version.
5. The run produces planned production, material requirements, projected balances, capacity load and exception messages.
6. A run is immutable; replanning creates a new run and a bridge explaining the change.

### 5.3 Supply and capacity approval

1. The planner reviews shortages, late supply, capacity overload, shelf-life and cash/inventory exposure.
2. Candidate levers include date/quantity change, alternate approved material, overtime/extra shift, external production, purchase requisition or demand escalation.
3. Approved planned production becomes a work-order proposal linked to the demand and planning run.
4. Material and capacity feasibility are revalidated before release.
5. Release creates reservations/commitments, not fictitious physical movements.

### 5.4 Work-order execution

1. A released work order carries product, quantity, BOM/routing versions, planned dates, batch policy and responsible work center.
2. Operations begin in routing sequence; actual start/end, resource and status are recorded.
3. Required material is requested from S3/P4 and confirmed by warehouse issue movement.
4. Additional issue, substitution and return require reason and approval policy.
5. Downtime, hold and exception states are explicit and feed replanning.

### 5.5 Batch, yield, scrap and quality

1. Production output is recorded by batch/lot and work order.
2. Good quantity, scrap, rework, by-product and material consumption are separated.
3. Quality checks use versioned specifications and retain measurements/evidence.
4. Accepted output becomes a finished-goods receipt command; failed/uncertain output becomes quarantine or rework.
5. S3/P4 confirms the physical receipt and movement before stock is available.

### 5.6 Close, cost and learning

1. Work-order close verifies all material issues/returns, output receipts, open operations and QC.
2. P5 snapshots actual material, labor/machine and external-service evidence.
3. Plan-versus-actual quantity, time, yield, scrap and cost variance are published to BigQuery.
4. Recurrent variance may propose BOM, routing, safety-stock, lead-time or capacity-policy review.
5. Growth Engine receives updated supply feasibility and production constraints.

## 6. Operational schema proposal

### S3 item-model addition

The existing `products` and `product_variants` remain the commercial catalog. Add a generalized stocked-item layer so raw material, packaging and WIP do not masquerade as sellable variants.

These are canonical S3 tables. The names below use the existing `app` physical namespace from [[Fullkit Schema Blueprint]]; `inventory` remains their logical domain per [[Fullkit Technical Architecture]].

| Table | Grain | Key fields |
|---|---|---|
| `app.inventory_items` | One stocked/planned item | `id`, `workspace_id`, `brand_id`, `product_variant_id` nullable, `sku`, `name`, `item_type`, `base_uom_id`, `lot_control`, `shelf_life_days`, `status` |
| `app.units_of_measure` | One UOM definition | `id`, `code`, `name`, `dimension_type`, `precision`, `status` |
| `app.item_uom_conversions` | One item/general from-to conversion version | `id`, `inventory_item_id` nullable, `from_uom_id`, `to_uom_id`, `factor`, `rounding_rule`, `valid_from`, `valid_to` |
| `app.item_location_policies` | One item x location planning policy | `inventory_item_id`, `inventory_location_id`, `safety_stock_qty`, `reorder_policy`, `lead_time_days`, `min_order_qty`, `order_multiple`, `status` |

S3 `inventory_levels`, `inventory_reservations` and `inventory_movements` should reference `inventory_item_id` in the generalized target model. A compatibility relationship keeps sellable variants resolvable during migration.

### Manufacturing master data

`manufacturing` is the P5 logical ownership namespace. The MVP may implement prefixed `app.manufacturing_*` tables and split the physical schema only when permissions, load or release isolation justify it.

| Table | Grain | Key fields |
|---|---|---|
| `manufacturing.boms` | One BOM identity for an output item | `id`, `workspace_id`, `output_item_id`, `name`, `status`, `current_version_id` |
| `manufacturing.bom_versions` | One immutable effective BOM | `id`, `bom_id`, `version`, `output_qty`, `output_uom_id`, `valid_from`, `valid_to`, `yield_assumption`, `approved_by`, `approved_at` |
| `manufacturing.bom_components` | One component line x BOM version | `id`, `bom_version_id`, `component_item_id`, `quantity`, `uom_id`, `scrap_factor`, `issue_stage`, `substitution_group_ref` |
| `manufacturing.routings` | One routing identity for an output item | `id`, `output_item_id`, `name`, `status`, `current_version_id` |
| `manufacturing.routing_versions` | One immutable routing revision | `id`, `routing_id`, `version`, `valid_from`, `valid_to`, `approved_by`, `approved_at` |
| `manufacturing.routing_operations` | One ordered operation x routing version | `id`, `routing_version_id`, `sequence`, `work_center_id`, `operation_type`, `setup_time`, `run_time_per_unit`, `queue_time`, `yield_assumption` |
| `manufacturing.work_centers` | One production resource group | `id`, `workspace_id`, `location_id`, `code`, `name`, `capacity_uom`, `default_cost_rate`, `status` |
| `manufacturing.capacity_calendars` | One work center x time interval capacity | `id`, `work_center_id`, `start_at`, `end_at`, `available_capacity`, `reason_type`, `status` |
| `manufacturing.quality_specs` | One versioned item/operation quality specification | `id`, `subject_type`, `subject_id`, `version`, `tests`, `acceptance_rules`, `valid_from`, `approved_by` |

### Planning and execution

| Table | Grain | Key fields |
|---|---|---|
| `manufacturing.demand_snapshots` | One source demand version | `id`, `growth_forecast_ref`, `scenario_ref`, `model_run_ref`, `captured_at`, `status` |
| `manufacturing.demand_lines` | One item x location x time bucket demand | `id`, `demand_snapshot_id`, `item_id`, `location_id`, `bucket_start`, `bucket_end`, `quantity`, `demand_type`, `confidence` |
| `manufacturing.planning_runs` | One immutable MRP execution | `id`, `demand_snapshot_id`, `horizon_start`, `horizon_end`, `policy_version`, `input_snapshot_ref`, `status`, `started_at`, `completed_at` |
| `manufacturing.projected_balances` | One run x item x location x time bucket | `planning_run_id`, `item_id`, `location_id`, `bucket_start`, `opening_qty`, `demand_qty`, `scheduled_supply_qty`, `planned_supply_qty`, `closing_qty` |
| `manufacturing.material_requirements` | One run x parent supply x component x need date | `id`, `planning_run_id`, `parent_requirement_ref`, `component_item_id`, `location_id`, `required_at`, `gross_qty`, `available_qty_snapshot`, `net_qty`, `shortage_qty` |
| `manufacturing.planned_orders` | One suggested production/purchase supply | `id`, `planning_run_id`, `supply_type`, `item_id`, `location_id`, `quantity`, `release_by`, `due_at`, `status`, `source_requirement_refs` |
| `manufacturing.planning_exceptions` | One actionable MRP/capacity exception | `id`, `planning_run_id`, `exception_type`, `item_or_work_center_ref`, `required_at`, `severity`, `evidence_refs`, `recommended_action`, `owner_id`, `status` |
| `manufacturing.work_orders` | One approved production order | `id`, `planned_order_id`, `output_item_id`, `location_id`, `planned_qty`, `completed_qty`, `bom_version_id`, `routing_version_id`, `planned_start`, `planned_end`, `status`, `released_by` |
| `manufacturing.work_order_operations` | One operation instance x work order | `id`, `work_order_id`, `routing_operation_id`, `work_center_id`, `sequence`, `planned_capacity`, `status`, actual timestamps, `operator_id` |
| `manufacturing.material_transactions` | One P5 request/confirmation for issue, return or substitution | `id`, `work_order_id`, `component_item_id`, `transaction_type`, `requested_qty`, `confirmed_qty`, `inventory_movement_id`, `lot_id`, `reason_code`, `status` |
| `manufacturing.production_batches` | One produced batch/lot x work order | `id`, `work_order_id`, `lot_code`, `started_at`, `completed_at`, `good_qty`, `rework_qty`, `scrap_qty`, `status` |
| `manufacturing.yield_records` | One operation/batch yield observation | `id`, `production_batch_id`, `operation_id`, `input_qty`, `good_qty`, `rework_qty`, `scrap_qty`, `reason_codes`, `recorded_by` |
| `manufacturing.quality_checks` | One quality test execution | `id`, `production_batch_id`, `quality_spec_id`, `test_key`, `measured_value`, `result`, `evidence_ref`, `reviewed_by`, `reviewed_at` |
| `manufacturing.finished_goods_receipts` | One requested/confirmed output receipt | `id`, `production_batch_id`, `item_id`, `quantity`, `location_id`, `disposition`, `wms_receipt_id`, `inventory_movement_id`, `status` |
| `manufacturing.production_cost_snapshots` | One work order x close version | `id`, `work_order_id`, `version`, `material_cost`, `labor_cost`, `machine_cost`, `external_cost`, `overhead_basis`, `currency_code`, `captured_at` |

## 7. BigQuery marts

| Model | Grain | Purpose |
|---|---|---|
| `fct_raw_material_balance_daily` | Date x location x material | On-hand, reserved, projected use, scheduled supply and shortage |
| `fct_production_forecast` | Time bucket x output item x scenario | Demand, planned production, capacity and projected finished-goods balance |
| `fct_mrp_requirement` | Planning run x material requirement | Gross/net requirement, shortage, lead-time and action |
| `fct_capacity_load` | Time bucket x work center | Available, committed and overload capacity |
| `fct_work_order` | Work order | Plan/actual quantity, dates, status, BOM/routing version and cycle time |
| `fct_production_batch` | Production batch | Inputs, outputs, yield, scrap, rework, QC and release |
| `fct_material_consumption_variance` | Work order x component | Standard versus actual usage and cost |
| `fct_production_cost_variance` | Work order/output item | Standard/planned/actual unit cost and drivers |
| `fct_batch_traceability` | Output lot x input lot | End-to-end genealogy for investigation/recall |
| `fct_supply_service_risk` | Date x finished good | Forecast demand, projected availability, stockout and marketing constraint |

## 8. APIs and events

### Commands

- `POST /manufacturing/demand-snapshots`
- `POST /manufacturing/planning-runs`
- `POST /manufacturing/planned-orders/{id}/approve`
- `POST /manufacturing/work-orders`, release/hold/reschedule/close commands
- `POST /manufacturing/work-orders/{id}/material-requests`
- `POST /manufacturing/work-order-operations/{id}/start-or-complete`
- `POST /manufacturing/production-batches`
- `POST /manufacturing/quality-checks`
- `POST /manufacturing/finished-goods-receipts`
- Versioned BOM, routing, capacity calendar and quality-spec commands

### Read APIs

- Raw-material balance and shortage projection
- Planning-run inputs, outputs and bridge to prior run
- Work-center load and available capacity
- Work-order material, operation, batch and QC state
- Batch/lot genealogy
- Finished-goods availability risk for Growth Engine

### Domain events

`production_demand_snapshot_received`, `mrp_run_completed`, `material_shortage_detected`, `capacity_overload_detected`, `planned_order_approved`, `work_order_released`, `material_issue_requested`, `material_issue_confirmed`, `production_operation_completed`, `production_batch_completed`, `quality_check_failed`, `finished_goods_receipt_requested`, `finished_goods_received`, and `work_order_closed`.

P5 consumes `growth_forecast_approved`, `inventory_balance_changed`, `inventory_reservation_changed`, `material_received`, `finished_goods_receipt_confirmed` and actual-order demand signals.

## 9. AI boundary

AI may:

- Explain raw-material balance and MRP exceptions
- Propose plan scenarios, rescheduling, capacity changes or approved substitutions
- Flag unusual consumption, yield, scrap, downtime and lead-time patterns
- Draft work-order notes, shortage escalations and procurement recommendations
- Summarize plan changes and likely commercial impact

AI may not:

- Approve a BOM/routing/cost version or work-order release
- Change on-hand stock, confirm material issue or receive finished goods
- Pass quality inspection or release quarantined output
- Invent supplier lead times, conversion factors or material substitutions
- Commit demand/cash/capacity outside approved policy

All suggestions cite input snapshot, plan/model/policy version, confidence and constraints. Commands go through P5 and S3/P4 APIs with human approval for material, quality and production commitments.

## 10. KPIs

### Planning

- Forecast and plan bias/error by horizon, product and scenario
- Projected shortage value and days at risk
- Planning-run-to-approved-plan cycle time
- Schedule adherence and replanning frequency/reason
- Material and capacity exceptions resolved before required date

### Production

- Plan-versus-actual output quantity and completion date
- Throughput, cycle time and work-center utilization
- Yield, scrap and rework by item, batch, BOM and operation
- Material consumption variance
- Quality pass, quarantine and release time

### Inventory and economics

- Raw-material days of cover and slow/expiring material
- Finished-goods service level/stockout risk
- Production unit-cost variance and variance drivers
- Working-capital exposure from planned and excess production
- Traceability completeness from input lot to finished-good lot

## 11. Dependencies and risks

| Dependency/risk | Control |
|---|---|
| S3 models only sellable variants | Introduce generalized inventory items and UOMs before MRP |
| Forecast is treated as a committed order | Versioned scenarios, frozen horizons and human approval |
| BOM/routing changes rewrite history | Immutable effective versions snapped onto work orders |
| WMS and P5 both mutate balances | P5 requests; S3/P4 confirms every physical movement |
| UOM conversion creates silent shortages/cost error | Item-scoped conversions, precision/rounding rules and validation |
| Poor cycle/yield data creates false precision | Start with transparent defaults, show confidence and measure actuals |
| Material substitutes harm quality/compliance | Approved substitution groups and QC/approval gate |
| Production optimization ignores cash or demand uncertainty | Growth/S4 constraints and scenario comparison |
| Batch traceability is incomplete | Mandatory lot capture for controlled items and receipt/issue events |
| AI recommendation becomes an unauthorized commitment | Tool limits, preview, named approval and immutable input snapshot |

## 12. Staged MVP

### Stage 0 - Item and balance foundation

- Generalize S3 items/UOMs and map raw materials, packaging, WIP and finished goods.
- Establish reliable daily balances and movement provenance.
- Import current BOMs and production spreadsheets as versioned evidence.

### Stage 1 - Raw-material balance and manual plan

- Versioned BOMs, demand snapshots and transparent projected balances.
- Read-only raw-material shortage and finished-goods risk views.
- Planner records decisions and exports the approved plan while execution remains current-state.

### Stage 2 - MRP and work-order control

- Time-phased MRP, capacity calendars, planned orders and exception queue.
- Release work orders and request material reservation/issue through S3/P4.
- Record batch, yield, scrap and finished-goods receipt for one product family.

### Stage 3 - Quality, costing and closed loop

- Quality specifications, quarantine/release, lot genealogy and production cost snapshots.
- Plan-versus-actual marts and Growth Engine supply constraints.
- Expand across brands/product families after item and process mapping pass.

### Stage 4 - Guided optimization

- AI-assisted scenario, exception and rescheduling proposals.
- Bounded automated task creation for proven low-risk exceptions.
- No autonomous physical movement, QC release or production commitment.

## 13. MVP acceptance criteria

- Every planned/actual material and finished good resolves to one canonical S3 inventory item and UOM.
- A work order retains the exact approved demand, BOM, routing and cost assumptions used at release.
- P5 cannot change stock; every issue, return, scrap and receipt resolves to a confirmed S3 movement.
- The raw-material balance explains opening stock, demand, scheduled/planned supply and projected closing balance.
- A finished-good batch traces to consumed lots, operations, QC and warehouse receipt.
- Growth Engine can see a dated, confidence-labelled production constraint before committing a marketing plan.
