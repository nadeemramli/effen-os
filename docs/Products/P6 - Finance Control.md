---
title: P6 - Finance Control
description: Product requirements for Fullkit commerce reconciliation, commission calculation, spend and card analysis, cost allocation, contribution control and SQL Accounting export.
created: 2026-07-16
updated: 2026-07-16
status: proposed
tags: [fullkit, p6, finance, reconciliation, commission, contribution]
---

# P6 - Finance Control

> [!summary] Product decision
> P6 is a finance **control and reconciliation** product, not a general ledger. It explains how orders, payments, settlements, fees, refunds, advertising, cards, costs and commissions connect; routes exceptions; and exports approved entries. **SQL Accounting remains the authoritative accounting ledger.**

Portfolio context: [[Fullkit Product Portfolio PRD]]. Infrastructure context: [[PRD]], [[Fullkit Technical Architecture]], [[Fullkit Schema Blueprint]], [[S4 - Money]] and [[Growth Engine]].

## 1. Thesis and users

Commerce money is fragmented across order sources, four gateways, marketplaces, ad platforms, cards, couriers and spreadsheets. P6 should make each economic event traceable and reconcilable without pretending that platform spend, an invoice, a card charge and a GL posting are the same record.

Primary users:

- Finance executives importing and reviewing source evidence
- Finance manager/controller approving matches, rules, commissions and close
- Marketplace/gateway reconciliation operator
- Marketing/finance partner matching platform spend to invoices and cards
- Department owners classifying and explaining expenses
- Growth Operator using governed contribution and cash constraints
- Management reviewing exceptions, leakage and commercial economics

## 2. Standalone versus stitched boundary

P6 is a standalone control workflow over S4 operational evidence and BigQuery commercial marts.

| Concern | P6 owns | External/shared authority |
|---|---|---|
| Payment and refund state | Review/match cases and evidence composition | S4/provider-verified payment/refund records |
| Settlement and payout | Matching, confidence, exception and close workflow | Gateway/marketplace settlement evidence |
| Marketing cost | Spend/invoice/card/GL linkage and exceptions | Normalized ad fact; provider invoice; bank/card statement; SQL Accounting posting |
| Commission/payable | Versioned deterministic rules, runs, approval and export | SQL Accounting/AP pays and records official liability/payment |
| Product/order cost | Cost versions, order-item snapshots and allocation evidence | S3/P5 supplies item/production evidence; SQL Accounting owns ledger valuation policy |
| Profitability | Governed commerce contribution views | BigQuery/dbt metric contract |
| Accounting | Approved export batch and receipt | SQL Accounting remains official ledger |

There is no Fullkit wallet or stored-value account. Approved commissions become payable/accounting exports unless the business explicitly decides to introduce a regulated/controlled wallet later.

## 3. Scope

- Ingest and preserve payment, refund, settlement, payout and marketplace fee evidence
- Reconcile order → payment → settlement line → payout
- Match Meta/Google/TikTok daily spend to provider invoices, card/bank charges and accounting entries
- Differentiate spend consumption, billing document, payment instrument charge and GL posting
- Credit-card and expense classification by legal entity, brand, department, product/campaign and cost center
- Versioned allocation rules with manual review for uncertain items
- Deterministic commission rules, runs, entries, approval and payables export
- Versioned product/variant cost and order-item cost snapshots
- Fulfilment, shipping, payment, marketplace and other variable-cost entries
- Contribution and cash-realization analysis
- Period close checklist, reconciliation cases and SQL Accounting export/receipt

## 4. Non-goals

- Replacing SQL Accounting, bank reconciliation, statutory accounts, tax or audited financial statements
- Maintaining an internal wallet/withdrawal product
- Treating platform-reported revenue/ROAS as accounting revenue or incremental contribution
- Editing historical cost, FX or commission versions after approved use
- Automatically posting uncertain entries to SQL Accounting
- Storing card credentials or exposing complete sensitive card data
- Allowing an AI model to approve payments, commissions, write-offs or GL exports

## 5. Complete workflows

### 5.1 Evidence intake and normalization

1. Source adapters ingest S1 orders, provider payments/refunds, marketplace/gateway settlements, courier charges, ad-platform spend, invoices, statements/card transactions, inventory/production cost and SQL Accounting export receipts.
2. Raw payloads/documents are immutable, checksum-addressed and linked to integration, source ID and ingestion run.
3. Staging normalizes currency, timestamp, legal entity, store/channel, tax and fee type without discarding source values.
4. Completeness, uniqueness, control-total and freshness checks gate reconciliation.
5. Unmapped accounts, variants, stores, currencies or source IDs enter an owned exception queue.

### 5.2 Order-payment-settlement-payout reconciliation

1. P6 matches payment evidence to S1 order using provider ID, source order ID, amount, currency and time.
2. Settlement lines match payments/orders using deterministic rules first; probabilistic suggestions remain reviewable.
3. Gross, fee, withholding/refund and net components must explain the settlement line.
4. Settlement batches match payout/bank evidence.
5. Unmatched, partial, duplicate, amount/date/currency variance and stale items create reason-coded cases.
6. Period reconciliation closes only when control totals pass or named exceptions are approved with rationale.

### 5.3 Marketing spend reconciliation

1. Normalized daily platform spend records economic consumption by account/campaign/day.
2. Provider invoices record billed documents and billing periods.
3. Card/bank transactions record payment instrument charges and FX/fees.
4. SQL Accounting export/receipt records the official ledger posting.
5. P6 links these records many-to-many where billing periods, top-ups, taxes, credits or currencies require it.
6. Variances distinguish timing, tax, FX, credits, fees, account mapping and missing evidence.

### 5.4 Card and expense analysis

1. Statement/card/expense lines enter with masked account, merchant, date, currency and source evidence.
2. Deterministic mappings apply approved legal entity, cost category, cost center, brand, department and optional product/campaign.
3. AI may suggest classification with confidence and evidence; low-confidence/material lines require owner review.
4. Split allocations preserve exact amounts and a versioned allocation rule.
5. Approved classifications become export lines; the SQL Accounting receipt confirms posting.

### 5.5 Commission calculation

1. Finance publishes an effective-dated, testable commission-rule version with eligibility, basis, rates, exclusions, return/refund treatment and beneficiary.
2. A commission run snapshots eligible order/payment/delivery/refund facts for a period.
3. Deterministic entries show basis, rule step and exact calculation.
4. Returns, cancellations or late adjustments become explicit reversal/adjustment entries rather than editing history.
5. Reviewer approves/rejects the run; approved entries enter a payables/accounting export.
6. SQL Accounting/AP remains payment and official liability authority.

### 5.6 Contribution cost and close

1. Variant cost versions define effective standard/actual policy and currency.
2. Order confirmation/fulfilment snapshots the applicable item cost so later cost changes do not rewrite historical contribution.
3. Payment, marketplace, shipping, fulfilment, commission and other variable-cost entries join the order/order item with provenance.
4. BigQuery publishes gross, net and contribution metrics under governed definitions.
5. A close period tracks source coverage, reconciliation pass, cost coverage, open cases, approved adjustments, exports and receipts.
6. Close completion freezes the control version while later changes enter a new adjustment period/version.

## 6. Operational schema proposal

P6 operates the canonical S4 records described in [[Fullkit Schema Blueprint]] and [[S4 - Money]]. Shared money evidence, cost versions, commission records and accounting-export records stay under the S4 `app` contract. Only P6-specific review, allocation-rule, close and exception workflow state belongs under the logical `finance` namespace; per [[Fullkit Technical Architecture]], the MVP may physically prefix it under `app`.

### Cost, expense and spend evidence

| Table | Grain | Key fields |
|---|---|---|
| `app.expense_categories` | One governed expense/cost category | `id`, `workspace_id`, `code`, `name`, `variable_or_fixed`, `contribution_treatment`, `sql_accounting_account_ref`, `status` |
| `app.cost_centers` | One responsibility/cost center | `id`, `legal_entity_id`, `brand_id` nullable, `code`, `name`, `owner_membership_id`, `status` |
| `finance.allocation_rules` | One allocation rule identity | `id`, `workspace_id`, `name`, `source_type`, `status`, `current_version_id` |
| `finance.allocation_rule_versions` | One immutable effective allocation rule | `id`, `allocation_rule_id`, `version`, `conditions`, `allocations`, `valid_from`, `valid_to`, `approved_by`, `approved_at` |
| `app.expense_documents` | One invoice/receipt/statement document | `id`, `integration_id`, `document_type`, `external_document_id`, `vendor_ref`, `legal_entity_id`, `currency_code`, `gross_amount`, `tax_amount`, `document_date`, `period_start`, `period_end`, `storage_ref`, `checksum`, `status` |
| `app.expense_lines` | One source document line | `id`, `expense_document_id`, `external_line_id`, `description`, `quantity`, `net_amount`, `tax_amount`, `gross_amount`, `source_account_ref`, `service_period` |
| `app.card_accounts` | One masked card/payment account | `id`, `legal_entity_id`, `provider`, `masked_identifier`, `currency_code`, `owner_membership_id`, `status` |
| `app.card_transactions` | One statement transaction | `id`, `card_account_id`, `external_transaction_id`, `merchant`, `transaction_at`, `posted_at`, `transaction_currency`, `transaction_amount`, `billing_currency`, `billing_amount`, `fx_amount`, `status` |
| `app.expense_allocations` | One expense/card line x target allocation | `id`, `source_type`, `source_id`, `legal_entity_id`, `brand_id`, `department_key`, `cost_center_id`, `expense_category_id`, `product_id`, `campaign_ref`, `amount`, `currency_code`, `rule_version_id`, `confidence`, `approved_by` |
| `app.marketing_spend_records` | One normalized operational evidence line for platform x account x date x currency | `id`, `integration_id`, `ad_account_ref`, `spend_date`, `currency_code`, `spend_amount`, `provider_source_ref`, `warehouse_fact_ref`, `status` |
| `finance.spend_document_links` | One spend range/entry x invoice/credit line allocation | `id`, `ad_spend_ref`, `expense_line_id`, `allocated_amount`, `match_method`, `confidence`, `status` |
| `finance.expense_matches` | One source-line-to-source-line financial match | `id`, `left_type`, `left_id`, `right_type`, `right_id`, `matched_amount`, `variance_amount`, `match_method`, `confidence`, `reviewed_by`, `status` |

`app.marketing_spend_records` references the one normalized spend pipeline used by P3, P6 and the Growth Engine; it is not a second P6 calculation.

### Commerce costs and commissions

| Table | Grain | Key fields |
|---|---|---|
| `app.variant_cost_versions` | One variant/item x effective cost version | `id`, `inventory_item_or_variant_id`, `cost_method`, `unit_cost`, `currency_code`, `valid_from`, `valid_to`, `source_ref`, `approved_by` |
| `app.order_item_cost_snapshots` | One order item x cost component at accepted version | `id`, `order_item_id`, `cost_component_type`, `cost_version_ref`, `unit_cost`, `quantity`, `amount`, `currency_code`, `captured_at` |
| `app.order_cost_entries` | One order/order-item variable-cost evidence item | `id`, `order_id`, `order_item_id`, `cost_type`, `provider_ref`, `source_record_ref`, `amount`, `currency_code`, `occurred_at`, `status` |
| `app.commission_rules` | One commission rule identity | `id`, `workspace_id`, `name`, `beneficiary_type`, `status`, `current_version_id` |
| `app.commission_rule_versions` | One immutable effective rule | `id`, `commission_rule_id`, `version`, `eligibility_conditions`, `basis_definition`, `rate_steps`, `refund_return_policy`, `valid_from`, `valid_to`, `approved_by` |
| `finance.commission_entry_calculations` | One rule-step explanation x commission entry | `id`, `commission_entry_id`, `rule_version_id`, `input_fact_refs`, `basis_amount`, `rate_or_formula`, `result_amount`, `explanation` |
| `finance.payables_exports` | One approved payable export batch | `id`, `legal_entity_id`, `period_start`, `period_end`, `export_type`, `source_run_ref`, `currency_code`, `total_amount`, `approved_by`, `status`, `export_ref` |
| `finance.payables_export_lines` | One beneficiary/payable line | `id`, `payables_export_id`, `beneficiary_ref`, `commission_entry_id`, `amount`, `accounting_mapping_ref`, `status` |

### Reconciliation, close and accounting handoff

| Table | Grain | Key fields |
|---|---|---|
| `finance.reconciliation_cases` | One financial mismatch/exception | `id`, `case_type`, `legal_entity_id`, `source_refs`, `currency_code`, `expected_amount`, `observed_amount`, `variance_amount`, `severity`, `owner_id`, `status`, timestamps |
| `finance.case_actions` | One case review/action | `id`, `reconciliation_case_id`, `action_type`, `decision`, `reason_code`, `evidence_refs`, `actor_id`, `occurred_at` |
| `app.exchange_rate_versions` | One currency pair x rate type x effective date/version | `id`, `base_currency`, `quote_currency`, `rate_type`, `effective_date`, `rate`, `source_ref`, `approved_by` |
| `finance.close_periods` | One legal entity x accounting period control | `id`, `legal_entity_id`, `period_start`, `period_end`, `status`, `opened_by`, `closed_by`, `closed_at`, `control_totals_ref` |
| `finance.close_checks` | One checklist/control x close period | `id`, `close_period_id`, `check_type`, `expected_value`, `observed_value`, `result`, `evidence_refs`, `owner_id`, `approved_by` |
| `app.accounting_export_batches` | One SQL Accounting export submission | `id`, `legal_entity_id`, `close_period_id`, `export_type`, `schema_version`, `row_count`, `debit_total`, `credit_total`, `file_ref`, `checksum`, `approved_by`, `status` |
| `app.accounting_export_lines` | One proposed accounting line | `id`, `accounting_export_batch_id`, `source_object_type`, `source_object_id`, `account_ref`, `cost_center_ref`, `debit_amount`, `credit_amount`, `currency_code`, `description` |
| `app.accounting_export_receipts` | One import/posting response | `id`, `accounting_export_batch_id`, `external_batch_ref`, `accepted_count`, `rejected_count`, `posted_at`, `response_ref`, `status` |

All money uses exact numeric types and ISO currency. Corrections use adjustment/reversal records; approved source history is not overwritten.

## 7. BigQuery marts

| Model | Grain | Purpose |
|---|---|---|
| `fct_order_contribution` | Order/order item | Revenue, refund, discount, COGS and all governed variable costs |
| `fct_commercial_daily` | Date x brand x market | Revenue through contribution, new/returning mix and plan comparison |
| `fct_payment_settlement_reconciliation` | Payment/settlement line | Match state, fee, payout and exception |
| `fct_cash_realization` | Order/payment cohort x period | Order-to-collected-to-settled cash timing |
| `fct_marketing_spend_reconciliation` | Account x billing period/currency | Platform spend, invoice, card/bank, tax/FX and GL-posted amount |
| `fct_marketplace_fee` | Order/settlement line x fee type | Expected/actual fee and leakage |
| `fct_commission_payable` | Beneficiary x period x entry | Basis, rule, earned, reversed, approved and exported |
| `fct_card_expense_classification` | Card transaction/expense line | Allocation, confidence, review and export state |
| `fct_cost_coverage` | Date x brand/product/channel | Percentage of orders/revenue with complete cost components |
| `fct_finance_close_exception` | Close period x case | Open amount, age, materiality, owner and resolution |

Governed metrics preserve distinct `gross_ltv`, `net_ltv` and `contribution_ltv` definitions from [[Fullkit Schema Blueprint]]. P6 must not expose one ambiguous “profit” or “LTV” field.

## 8. APIs and events

### Commands

- `POST /finance/reconciliation-runs`
- `POST /finance/reconciliation-matches/{id}/approve-or-reject`
- `POST /finance/reconciliation-cases/{id}/resolve`
- `POST /finance/expense-allocations`
- `POST /finance/allocation-rules/{id}/versions`
- `POST /finance/commission-runs`
- `POST /finance/commission-runs/{id}/approve`
- `POST /finance/payables-exports`
- `POST /finance/close-periods/{id}/run-checks`
- `POST /finance/accounting-export-batches`
- `POST /finance/accounting-export-batches/{id}/submit`

### Read APIs

- Order/payment/settlement/payout evidence timeline
- Spend/invoice/card/GL reconciliation
- Expense/card classification and confidence
- Commission calculation explanation and reversal history
- Order contribution and missing-cost coverage
- Close checklist, open cases and materiality
- SQL Accounting export/receipt status

### Domain events

`financial_evidence_received`, `payment_reconciled`, `settlement_variance_detected`, `payout_reconciled`, `marketing_spend_reconciled`, `expense_classification_proposed`, `expense_allocation_approved`, `commission_run_calculated`, `commission_run_approved`, `payables_export_ready`, `cost_snapshot_created`, `finance_close_blocked`, `finance_close_completed`, `accounting_export_submitted`, and `accounting_export_accepted`.

P6 consumes `order_confirmed`, `payment_collected`, `refund_completed`, `shipment_handed_over`, `order_delivered`, `return_disposition_approved`, normalized ad-spend availability and production-cost/version events.

## 9. AI boundary

AI may:

- Suggest expense, card and reconciliation matches with confidence and evidence
- Explain fee, FX, timing, quantity and mapping variances
- Detect anomalous commission, settlement, spend or cost patterns
- Draft case summaries and request missing evidence
- Propose allocation or close-check actions

AI may not:

- Mark a provider payment/refund/payout as verified
- Approve a commission run, payable, write-off or period close
- Post to SQL Accounting or change the official ledger
- Change effective cost, FX, allocation or commission rules
- Receive full card credentials or unrestricted financial/PII tables
- Hide uncertainty behind a generated narrative

Deterministic rules calculate money. AI assists matching and explanation. Material or low-confidence actions require a finance approver, and every suggestion retains source evidence, rule/model version and review outcome.

## 10. KPIs

### Reconciliation and close

- Auto-match rate by source and match method
- Reconciled value percentage and unexplained variance
- Open exception amount, age and time to resolution
- Source freshness, control-total and mapping pass rate
- Days/time to finance control close and SQL Accounting export acceptance

### Commission and expense

- Commission calculation time, exception rate and reversals
- Percentage of commission entries with complete calculation lineage
- Card/expense classification coverage and review rate
- Unallocated or cross-entity expense value
- Approved export rejection/error rate

### Commercial economics

- Percentage of orders with complete COGS and variable-cost snapshots
- Contribution margin by brand, product, channel and cohort
- Fee leakage and unexpected provider/courier/marketplace cost
- Order-to-cash and settlement delay
- Marketing spend invoice/card/GL reconciliation variance

## 11. Dependencies and risks

| Dependency/risk | Control |
|---|---|
| SQL Accounting import/export capability is unclear | Validate supported schemas and receipts before automating; retain controlled file export fallback |
| Platform spend, invoice, card and GL are collapsed | Separate objects and explicit many-to-many matching |
| Historical costs change retrospectively | Effective-dated cost versions and immutable order-item snapshots |
| Commission requirements are assumed from Fighter | Confirm beneficiary, basis, eligibility and adjustment workflow before enabling |
| Missing marketplace/gateway details hide fees | Preserve settlement-line detail and source control totals |
| FX/tax timing causes false exceptions | Versioned rate/tax policy and reason-coded timing differences |
| Duplicate ingestion double-counts money | External-ID uniqueness, checksums, idempotency and reconciliation controls |
| AI suggestion is treated as approval | Distinct proposed/reviewed/approved states and named finance authority |
| Different dashboards calculate contribution differently | One dbt metric contract, cost-coverage flag and lineage |
| P6 drifts into a fragile accounting clone | Keep SQL Accounting authoritative and P6 focused on commerce control |

## 12. Staged MVP

### Stage 0 - Evidence and control totals

- Ingest orders, payments/refunds, settlements, marketplace fees, ad spend and relevant statements.
- Preserve immutable source evidence and establish daily control totals.
- Build read-only unmatched/variance views.

### Stage 1 - Payment/settlement and spend reconciliation

- Deterministic order-payment-settlement matching with exception cases.
- Meta spend to invoice/card matching for one legal entity/account set.
- Reconcile the same normalized spend fact used by P3 and Growth Engine.

### Stage 2 - Commission and cost snapshots

- Confirm actual commission policy, publish versioned rules and run in shadow mode.
- Add variant cost versions, order-item snapshots and key variable-cost entries.
- Approve and export, without wallets.

### Stage 3 - Expense allocation and close

- Card/expense classification, allocation rules and owner review.
- Period close checks and SQL Accounting export/receipt.
- Contribution and cost-coverage marts become management-facing.

### Stage 4 - Guided finance control

- AI-assisted match/classification/variance proposals.
- Automatic low-risk case creation and evidence requests.
- No autonomous approval, payment, write-off, close or GL posting.

## 13. MVP acceptance criteria

- One order can be traced through payment, settlement line, fee, payout and accounting handoff.
- Meta daily spend, provider invoice, card charge and SQL Accounting posting remain distinct and reconcilable.
- Commission entries reproduce exactly from an effective rule version and immutable input snapshot.
- Historical contribution does not change when a new product cost version is published.
- P6 can show every unresolved material variance, its owner, evidence and age.
- SQL Accounting remains the official ledger; Fullkit records only the approved export and resulting receipt.
- No Fullkit wallet or unrestricted AI financial mutation exists.
