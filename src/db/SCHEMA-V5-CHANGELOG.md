# Expense API Database Schema v5.0

> **For AI Agents:** This document explains the database schema so you can answer user questions about expenses. Read the "Quick Reference" section first, then dive into specific tables as needed.

---

## Quick Reference for AI Agents

### What This Database Does
This is an expense management system. Users submit expense reports (business trips, meals, software subscriptions, etc.), managers approve them, and finance posts them. Your job is to help users query their expenses, understand spending patterns, detect anomalies, and answer questions about budgets and policies.

### Where to Find Data (in order of preference)

1. **Pre-computed answers** → `spending_summaries` table has monthly/quarterly totals with narrative summaries already written
2. **Flat query surface** → `mv_expense_analytics` view is pre-joined, no JOINs needed, use this for ad-hoc queries
3. **Draft expenses** → `mv_user_expenses_all` view includes drafts (always filter by user_id!)
4. **Anomaly explanations** → `expense_anomalies` table has pre-written explanations
5. **AI insights** → `expense_insights` table has pre-generated trend analysis, forecasts, recommendations
6. **Policy checks** → Call `check_expense_policies()` function or query `expense_policies` table
7. **Prompt templates** → `llm_prompt_templates` table has templates for consistent response formatting

### Key Relationships
```
users ──┬── expense_reports ──── expense_lines
        │         │                    │
        │         └── project_id ──────┼── projects (has client info)
        │                              │
        └── department_id ─────────────┴── departments
```

---

## Complete Table Reference

### `users`
**What it stores:** User accounts with login credentials and organizational context.

**Why you need it:** Get the user's name, department, cost center, and spending profile. The `spending_profile` JSONB tells you their typical spending patterns without querying history. The `llm_preferences` JSONB tells you their preferred currency, date format, and default time ranges.

**Key columns:**
- `display_name` — Human-readable name (generated from first_name + last_name)
- `department_id` — Which department they belong to
- `manager_id` — Their direct manager (for approval chain)
- `cost_center` — Accounting cost center code
- `spending_profile` — `{"avg_monthly": 1800, "top_categories": ["Travel", "Meals"], "typical_range": [15, 500]}`
- `llm_preferences` — `{"default_currency": "USD", "default_period_months": 3, "dashboard_widgets": [...]}`

---

### `departments`
**What it stores:** Hierarchical organizational structure (Engineering > Backend > API Team).

**Why you need it:** Scope queries by department, understand org hierarchy, get department budgets.

**Key columns:**
- `full_path` — Human-readable path like `'Engineering > Backend'` (use this in responses)
- `ancestor_ids[]` — All parent department IDs for hierarchy queries
- `level` — Depth in hierarchy (1 = top-level)

---

### `projects`
**What it stores:** Client engagements and internal initiatives with embedded client details.

**Why you need it:** Answer "How much did we spend on Acme Corp?" or "What's Project Alpha's burn rate?" Client info is embedded directly (no separate clients table).

**Key columns:**
- `name`, `code` — Project identification
- `client_name`, `client_code`, `client_industry` — Client details (NULL for internal projects)
- `budget_amount`, `spent_amount` — Budget tracking
- `remaining_amount`, `utilization_pct` — Auto-computed budget metrics
- `full_path` — `'Acme Corporation > Project Alpha'` (use this in responses)
- `tags[]` — Freeform tags like `['billable', 'high-priority']`
- `status` — `active`, `on_hold`, `completed`, `cancelled`

**Example queries this enables:**
- "How much have we spent on Project Alpha?" → Query `spent_amount`
- "Which projects are over budget?" → `WHERE utilization_pct > 100`
- "Show all billable projects" → `WHERE 'billable' = ANY(tags)`

---

### `expense_reports`
**What it stores:** Grouped expense submissions with workflow status.

**Why you need it:** Understand report-level context (title, status, total, who submitted it).

**Key columns:**
- `status` — `draft`, `submitted`, `pending`, `approved`, `rejected`, `returned`, `posted`
- `total_amount`, `line_count` — Aggregates
- `category_breakdown` — JSONB like `{"Travel": 1650.00, "Meals": 547.50}`
- `top_category` — The largest category in this report
- `ai_summary` — Natural language description of the report
- `project_id`, `project_name`, `client_name` — Project association (denormalized)
- `tags[]` — Freeform tags like `['q4-offsite', 'client-visit']`
- `submitted_at`, `approved_at`, `posted_at` — Workflow timestamps

---

### `expense_lines`
**What it stores:** Individual expense transactions (the actual receipts/charges).

**Why you need it:** This is the core data. Each line is one expense (a flight, a meal, a software subscription).

**Key columns:**
- `description` — What the expense was for
- `amount`, `currency` — How much
- `category`, `category_code`, `category_path` — Categorization (denormalized)
- `merchant_name`, `merchant_category` — Where the money was spent
- `transaction_date` — When it happened
- `payment_method` — `corporate_card`, `personal_card`, `cash`, `bank_transfer`, `mobile_pay`
- `project_id`, `project_name`, `client_name` — Project association (denormalized)
- `tags[]` — Freeform tags like `['reimbursable', 'billable', 'tip-included']`
- `location_city`, `location_country` — Where

**Time dimensions (auto-generated):**
- `fiscal_year`, `fiscal_quarter`, `fiscal_month`, `fiscal_week`
- `day_of_week`, `is_weekend`

**Recurring expense fields:**
- `is_recurring` — TRUE if this is a recurring charge
- `recurrence_pattern` — `monthly`, `weekly`, `quarterly`, `annual`
- `recurrence_merchant` — Normalized merchant name for grouping recurring charges
- `recurrence_group_id` — Links related recurring charges together

**Anomaly fields:**
- `is_anomaly` — TRUE if flagged
- `anomaly_score` — Confidence score (0-1)
- `anomaly_reasons[]` — Array like `['unusual_amount', 'exceeds_typical_range']`

**Search fields:**
- `search_vector` — Full-text search (use `@@` operator)
- `description_embedding` — Vector embedding for semantic search

---

### `expense_categories`
**What it stores:** Hierarchical category taxonomy (Travel > Airfare, Meals > Client Entertainment).

**Why you need it:** Map natural language to categories, understand typical amounts.

**Key columns:**
- `full_path` — `'Travel > Airfare'` (use this in responses)
- `keywords[]` — `['flight', 'airline', 'plane', 'airfare']` for NL matching
- `synonyms[]` — Alternative names
- `typical_amount_range` — `{"min": 100, "max": 2000}` for anomaly context

---

### `expense_policies`
**What it stores:** Machine-readable policy rules that can be checked programmatically.

**Why you need it:** Answer "Does this expense violate policy?" or "What's our meal limit?"

**Key columns:**
- `name`, `code` — Policy identification
- `description` — Human-readable policy description
- `rule_type` — `max_amount`, `requires_receipt`, `time_limit`, `category_restriction`, etc.
- `rule_config` — `{"max_amount": 75, "currency": "USD"}` or `{"days_after_transaction": 30}`
- `violation_message` — User-friendly explanation when violated
- `severity` — `info`, `warning`, `hard_block`
- `applies_to_categories[]`, `applies_to_departments[]`, `applies_to_roles[]` — Scope

**Use `check_expense_policies(amount, category_id, department_id, transaction_date)` function** to check an expense against all active policies. Returns rows with policy violations.

**Seeded policies:**
| Code | Rule | Violation Message |
|---|---|---|
| POL-MEAL-LIMIT | max_amount: $75 | Individual meals cannot exceed $75 per person |
| POL-RECEIPT-25 | requires_receipt if >= $25 | A receipt is required for expenses over $25 |
| POL-TIME-30D | time_limit: 30 days | Expenses must be submitted within 30 days |
| POL-HOTEL-CAP | max_amount: $350 | Hotel rate exceeds $350/night cap |
| POL-AIR-ADVANCE | max_amount: $800 | Airfare exceeds $800, justify advance booking |
| POL-CLIENT-ENT | max_amount: $150 | Client entertainment exceeds $150/attendee limit |

---

### `spending_summaries`
**What it stores:** Pre-aggregated spending data by period, user, department, category.

**Why you need it:** **CHECK THIS FIRST** for trend questions. Avoids expensive real-time aggregation. Contains narrative summaries already written.

**Key columns:**
- `period_type` — `daily`, `weekly`, `monthly`, `quarterly`, `yearly`
- `period_start`, `period_end` — Date range
- `user_id`, `department_id`, `category_id` — Scope (NULL means all)
- `total_amount`, `transaction_count`, `report_count`
- `avg_transaction`, `median_transaction`, `std_deviation`
- `prev_period_amount`, `amount_change`, `pct_change` — Period-over-period
- `category_breakdown` — JSONB of category totals
- `top_merchants` — JSONB of top merchants
- `narrative_summary` — **Pre-written natural language summary** (use this!)

**Example:** For "How has my spending changed?" → Query `spending_summaries` and return the `narrative_summary` field directly.

---

### `expense_anomalies`
**What it stores:** Detected spending anomalies with explanations and resolution status.

**Why you need it:** Answer "Why was this flagged?" with a pre-written explanation.

**Key columns:**
- `anomaly_type` — `amount_outlier`, `frequency_spike`, `unusual_category`, `duplicate_suspect`, etc.
- `severity` — `low`, `medium`, `high`, `critical`
- `confidence` — Score from 0 to 1
- `context` — JSONB with details: `{"expected_range": [10, 120], "actual": 830, "z_score": 4.2}`
- `explanation` — **Pre-written natural language explanation** (use this!)
- `status` — `detected`, `reviewed`, `confirmed`, `dismissed`, `escalated`

---

### `expense_insights`
**What it stores:** Pre-generated AI insights (trends, forecasts, recommendations).

**Why you need it:** Surface proactive insights without generating them in real-time.

**Key columns:**
- `scope_type` — `user`, `department`, `organization`, `category`, `global`
- `scope_id` — The user/department/category ID (NULL for org-wide or global)
- `insight_type` — `trend`, `anomaly`, `recommendation`, `comparison`, `forecast`, `summary`
- `title` — Short headline
- `content` — **Pre-written natural language insight** (use this!)
- `supporting_data` — JSONB with the numbers behind the insight
- `confidence`, `relevance_score` — Quality scores

---

### `llm_prompt_templates`
**What it stores:** Prompt templates for consistent LLM responses.

**Why you need it:** Use these templates for specific analysis types to ensure consistent formatting.

**Available templates:**
| Name | Purpose |
|---|---|
| `monthly_summary` | Generate monthly spending summary |
| `anomaly_explanation` | Explain a detected anomaly |
| `spending_comparison` | Compare spending between periods/entities |
| `expense_forecast` | Forecast future spending |
| `policy_check_explanation` | Explain policy violations |
| `project_spending_report` | Project budget/burn rate analysis |
| `natural_language_query` | Parse NL into structured filters |

**Key columns:**
- `system_prompt` — System instructions
- `user_prompt_template` — Template with `{{placeholders}}`
- `required_context[]` — What data to gather before using the template
- `output_format` — `text`, `json`, `markdown`, `chart_config`

---

### `budgets`
**What it stores:** Budget allocations with real-time tracking.

**Why you need it:** Answer "Am I on track for my budget?" or "Which departments are over budget?"

**Key columns:**
- `user_id`, `department_id`, `category_id` — Scope
- `period_type`, `period_start`, `period_end` — Time period
- `budget_amount`, `spent_amount` — Tracking
- `remaining_amount`, `utilization_pct` — Auto-computed
- `alert_threshold_pct` — When to alert (typically 80%)

---

### `approval_history`
**What it stores:** Audit trail of approval actions with reviewer comments.

**Why you need it:** Answer "Why was my report rejected?" or "Who approved this?"

**Key columns:**
- `action` — `approve`, `reject`, `return`, `escalate`, `reassign`
- `comment` — Reviewer's explanation (use this!)
- `actor_id`, `actor_email` — Who took the action
- `step_number`, `step_name` — Which workflow step

---

### `merchants`
**What it stores:** Maps raw merchant strings to normalized names.

**Why you need it:** Aggregate spending by merchant across variations.

**Example:** `'HILTON HOTELS 12345 NYC'` → `'Hilton Hotels'`

---

### `llm_queries`
**What it stores:** History of user's natural language queries.

**Why you need it:** Answer "What did I ask about last week?" and learn from feedback.

**Key columns:**
- `original_query` — What the user typed
- `parsed_intent` — Structured interpretation
- `generated_sql` — SQL that was run
- `result_summary` — What was returned
- `was_helpful`, `user_feedback` — Quality feedback

---

## Materialized Views (Use These!)

### `mv_expense_analytics`
**What it is:** Pre-joined flat view of all expense data (excluding drafts).

**Use this for most queries.** No JOINs needed. Contains:
- User context (name, email, department, manager)
- Project/client context
- Report context (title, status, summary)
- Line details (amount, category, merchant, location)
- Time dimensions (fiscal year/quarter/month/week, day of week, weekend flag)
- Payment method
- Recurring expense info
- Anomaly flags
- Tags (report-level and line-level)
- Search vectors and embeddings

**Example:** "Show Emma's travel expenses over $500 in Q4" →
```sql
SELECT * FROM mv_expense_analytics
WHERE user_email = 'emma@...'
  AND category_path LIKE 'Travel%'
  AND amount > 500
  AND fiscal_quarter = 4
  AND fiscal_year = 2025;
```

### `mv_user_expenses_all`
**What it is:** Same as above but **includes drafts**.

**Use this when the user asks about their draft report.** Always filter by `user_id` for security.

---

## Key Functions

### `check_expense_policies(amount, category_id, department_id, transaction_date)`
Returns all policy violations for a given expense. Each row has `policy_name`, `severity`, `violation_message`.

### `generate_llm_context(user_id, include_recent, include_trends)`
Returns JSONB with user info, recent expenses, category totals, and project spending — ready to inject into prompts.

### `semantic_expense_search(query_embedding, limit, user_id_filter, category_filter, date_from, date_to)`
Vector similarity search on expense descriptions.

### `detect_amount_anomaly(user_id, amount, category, threshold)`
Checks if an amount is anomalous for a user+category. Returns `is_anomaly`, `z_score`, `stats`, `explanation`.

### `get_spending_trend(user_id, months)`
Returns monthly spending trend with month-over-month changes.

### `refresh_all_analytics_views()`
Refreshes both materialized views. Call after bulk data loads.

---

## Seed Data Summary

The database comes seeded with realistic data for testing:

- **9 users** across roles (superadmin, admin, finance, manager, employees, auditor)
- **6 projects** (4 client-billable, 2 internal)
- **12 expense reports** across all statuses (draft, submitted, approved, rejected, returned, posted)
- **62 expense lines** spanning Aug 2025 – Jan 2026
- **7 anomaly records** with explanations
- **11 spending summaries** with narrative summaries
- **6 pre-generated insights**
- **8 budget entries**
- **6 expense policies**
- **7 prompt templates**

---

## v5.0 Changes from v4.0

1. **Added `projects` table** — Client/project tracking with embedded client details
2. **Added `expense_policies` table** — Machine-readable policy rules
3. **Added `llm_prompt_templates` table** — Stored prompt templates
4. **Added to `expense_reports`:** `project_id`, `project_name`, `client_name`, `tags[]`
5. **Added to `expense_lines`:** `payment_method`, `project_id`, `project_name`, `client_name`, `tags[]`, `is_recurring`, `recurrence_group_id`, `recurrence_pattern`, `recurrence_merchant`
6. **Added to `users`:** `llm_preferences` JSONB
7. **Added `mv_user_expenses_all` view** — Includes drafts
8. **Updated `mv_expense_analytics`** — Added project, client, payment method, recurring, tags columns
9. **Added `check_expense_policies()` function**
10. **Added 14 new permissions** for projects, policies, and LLM features
11. **Expanded seed data** from 58 lines to 347 lines with full realistic data
