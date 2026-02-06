-- Expense API Database Schema v5.0 - LLM-Optimized
-- PostgreSQL 15+ with pgvector for AI/LLM integration
-- Optimized for: Semantic search, trend analysis, anomaly detection, natural language queries
--
-- Key LLM Features:
--   • Vector embeddings for semantic search (pgvector)
--   • Denormalized analytics views (avoid joins)
--   • Pre-aggregated spending summaries
--   • Hierarchical categories with full paths
--   • Anomaly detection metadata
--   • LLM conversation/query history
--   • Natural language insights storage
--   • Projects/client tracking for project-based queries
--   • Expense policy rules for LLM policy validation
--   • Prompt templates for consistent LLM front-end behavior
--   • Tags for freeform natural language filtering
--   • Payment method tracking for spend channel analysis
--   • Recurring expense detection metadata

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- Trigram for fuzzy text search

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Departments (hierarchical organization structure)
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    head_user_id UUID,  -- FK added after users table
    -- Hierarchy helpers for LLM (denormalized)
    level INTEGER DEFAULT 1,
    full_path TEXT,  -- 'Engineering > Backend > API Team'
    ancestor_ids UUID[],  -- All parent IDs for fast hierarchy queries
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Projects (client/project tracking for LLM project-based queries)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    description TEXT,
    -- Client details (embedded — avoids separate clients table)
    client_name VARCHAR(255),
    client_code VARCHAR(50),
    client_industry VARCHAR(100),
    client_contact_email VARCHAR(255),
    -- Project metadata
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    owner_user_id UUID,  -- FK added after users table
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
    -- Budget tracking
    budget_amount DECIMAL(14,2),
    budget_currency VARCHAR(3) DEFAULT 'USD',
    spent_amount DECIMAL(14,2) DEFAULT 0,
    remaining_amount DECIMAL(14,2) GENERATED ALWAYS AS (budget_amount - spent_amount) STORED,
    utilization_pct DECIMAL(7,2) GENERATED ALWAYS AS (
        CASE WHEN budget_amount > 0 THEN (spent_amount / budget_amount * 100) ELSE 0 END
    ) STORED,
    -- Dates
    start_date DATE,
    end_date DATE,
    -- LLM: Searchable fields
    tags TEXT[],  -- ['q4-launch', 'high-priority', 'billable']
    full_path TEXT,  -- 'Acme Corp > Project Alpha' (for LLM context)
    name_embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users table (v5.0 LLM-enhanced)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    display_name VARCHAR(255) GENERATED ALWAYS AS (COALESCE(first_name || ' ' || last_name, email)) STORED,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    username VARCHAR(255),
    password_hash VARCHAR(255),  -- NULL if OAuth-only user
    oauth_provider VARCHAR(50),  -- 'google', 'facebook', or NULL
    oauth_id VARCHAR(255),
    -- Security fields
    roles_version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    -- Organizational hierarchy
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    cost_center VARCHAR(50),
    -- LLM Analytics: Pre-computed user spending profile
    spending_profile JSONB DEFAULT '{}',  -- {"avg_monthly": 1500, "top_categories": ["Travel", "Meals"], "typical_range": [50, 500]}
    -- LLM: User preferences for personalized queries
    llm_preferences JSONB DEFAULT '{}',  -- {"default_currency": "USD", "date_format": "MM/DD/YYYY", "default_period_months": 3, "pinned_categories": ["Travel"], "dashboard_widgets": ["spending_trend", "anomalies"]}
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add FK from departments to users (head_user_id)
ALTER TABLE departments ADD CONSTRAINT fk_departments_head
    FOREIGN KEY (head_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Add FK from projects to users (owner_user_id)
ALTER TABLE projects ADD CONSTRAINT fk_projects_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Refresh tokens for JWT rotation (v3.0 enhanced)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    -- v3.0 session tracking
    ip_address INET,
    user_agent TEXT,
    revoked_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- RBAC TABLES
-- ============================================================================

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,  -- System roles cannot be deleted
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Permissions table (the permission registry)
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,  -- e.g., 'report.view.own'
    description TEXT,
    category VARCHAR(100),  -- e.g., 'report', 'role', 'user', 'workflow', 'audit'
    risk_level VARCHAR(20) CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    requires_mfa BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User-Role junction table (many-to-many)
CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);

-- Role-Permission junction table (many-to-many)
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (role_id, permission_id)
);

-- Separation of Duties (SoD) rules
CREATE TABLE IF NOT EXISTS sod_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    permission_set TEXT[] NOT NULL,  -- Array of permission names that cannot coexist
    risk_level VARCHAR(20) DEFAULT 'high',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- WORKFLOW TABLES
-- ============================================================================

-- Workflow definitions
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    conditions JSONB,  -- Amount ranges, categories, departments that trigger this workflow
    steps JSONB NOT NULL,  -- Array of workflow steps
    on_return_policy VARCHAR(50) DEFAULT 'hard_restart',  -- 'hard_restart' or 'soft_restart'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Workflow assignments (which departments/categories use which workflow)
CREATE TABLE IF NOT EXISTS workflow_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    expense_category VARCHAR(100),
    amount_min DECIMAL(12,2),
    amount_max DECIMAL(12,2),
    priority INTEGER DEFAULT 0,  -- Higher priority = checked first
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- EXPENSE MANAGEMENT TABLES (v3.0 enhanced)
-- ============================================================================

-- Expense reports (v5.0 with analytics metadata)
CREATE TABLE IF NOT EXISTS expense_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'pending', 'approved', 'rejected', 'returned', 'posted')),
    -- Organizational context
    department_id UUID REFERENCES departments(id),
    department_name VARCHAR(255),  -- Denormalized
    cost_center VARCHAR(50),
    -- Project/client association
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    project_name VARCHAR(255),  -- Denormalized for LLM
    client_name VARCHAR(255),   -- Denormalized from project
    -- Tags for freeform LLM filtering
    tags TEXT[],  -- ['q4-offsite', 'client-visit', 'team-building']
    -- Financial summary
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'USD',
    line_count INTEGER DEFAULT 0,
    -- Category breakdown (denormalized for LLM queries)
    category_breakdown JSONB DEFAULT '{}',  -- {"Travel": 1500.50, "Meals": 234.00}
    top_category VARCHAR(100),  -- Highest spend category
    -- Workflow
    workflow_id UUID REFERENCES workflows(id),
    workflow_snapshot JSONB,
    current_step INTEGER,
    -- Dates
    report_date DATE,
    period_start DATE,  -- Expense period covered
    period_end DATE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    posted_at TIMESTAMP WITH TIME ZONE,
    -- LLM: Pre-computed analytics
    processing_time_hours DECIMAL(10,2),  -- Time from submit to approve
    is_over_budget BOOLEAN DEFAULT false,
    budget_variance_pct DECIMAL(5,2),  -- +15.5 means 15.5% over budget
    -- LLM: Natural language summary (can be AI-generated)
    ai_summary TEXT,  -- "Business trip to NYC with 5 meals and 2 hotel nights"
    -- LLM: Semantic search
    content_embedding vector(1536),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Approval history for each report
CREATE TABLE IF NOT EXISTS approval_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name VARCHAR(255),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    action VARCHAR(50) NOT NULL CHECK (action IN ('approve', 'reject', 'return', 'escalate', 'auto_approve')),
    comment TEXT,
    rejection_category VARCHAR(100),
    report_hash VARCHAR(64),  -- SHA-256 of report state at time of action
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sla_deadline TIMESTAMP WITH TIME ZONE,
    was_escalated BOOLEAN DEFAULT false
);

-- Expense categories (v4.0 hierarchical with semantic search)
CREATE TABLE IF NOT EXISTS expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE,
    user_group VARCHAR(100),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- Hierarchy for drill-down analysis
    parent_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    level INTEGER DEFAULT 1,
    full_path TEXT,  -- 'Travel > Transportation > Flights'
    ancestor_ids UUID[],  -- For recursive queries
    -- LLM semantic matching
    keywords TEXT[],  -- ['airfare', 'plane', 'airline', 'booking']
    synonyms TEXT[],  -- Alternative names for fuzzy matching
    typical_amount_range JSONB,  -- {"min": 50, "max": 500, "currency": "USD"}
    -- Embedding for semantic search
    name_embedding vector(1536),  -- OpenAI ada-002 / text-embedding-3-small dimension
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Expense lines (v4.0 with embeddings and analytics metadata)
CREATE TABLE IF NOT EXISTS expense_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    original_amount DECIMAL(12,2),  -- If converted from another currency
    currency VARCHAR(3) DEFAULT 'USD',
    original_currency VARCHAR(3),
    exchange_rate DECIMAL(10,6),
    category_id UUID REFERENCES expense_categories(id),
    category VARCHAR(100),  -- Denormalized for fast queries
    category_code VARCHAR(50),
    category_path TEXT,  -- Denormalized: 'Travel > Lodging > Hotels'
    transaction_date DATE NOT NULL,
    merchant_name VARCHAR(255),
    merchant_category VARCHAR(100),  -- MCC category if from card data
    location_city VARCHAR(100),
    location_country VARCHAR(3),
    -- Payment method (LLM: "show me all corporate card expenses")
    payment_method VARCHAR(50) CHECK (payment_method IN ('corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other')),
    -- Project association (denormalized from report for flat queries)
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    project_name VARCHAR(255),  -- Denormalized
    client_name VARCHAR(255),   -- Denormalized
    -- Tags for freeform LLM filtering
    tags TEXT[],  -- ['reimbursable', 'billable', 'tip-included']
    -- Recurring expense detection
    is_recurring BOOLEAN DEFAULT false,
    recurrence_group_id UUID,  -- Groups related recurring charges
    recurrence_pattern VARCHAR(50),  -- 'monthly', 'weekly', 'quarterly', 'annual'
    recurrence_merchant VARCHAR(255),  -- Normalized merchant for recurrence matching
    -- LLM: Semantic search embedding
    description_embedding vector(1536),
    -- LLM: Full-text search
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(description, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(merchant_name, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(category, '')), 'C')
    ) STORED,
    -- LLM: Anomaly flags (pre-computed)
    is_anomaly BOOLEAN DEFAULT false,
    anomaly_score DECIMAL(5,4),  -- 0.0000 to 1.0000
    anomaly_reasons TEXT[],  -- ['unusual_amount', 'weekend_expense', 'unusual_category']
    -- Time dimensions for trend analysis
    fiscal_year INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM transaction_date)) STORED,
    fiscal_quarter INTEGER GENERATED ALWAYS AS (EXTRACT(QUARTER FROM transaction_date)) STORED,
    fiscal_month INTEGER GENERATED ALWAYS AS (EXTRACT(MONTH FROM transaction_date)) STORED,
    fiscal_week INTEGER GENERATED ALWAYS AS (EXTRACT(WEEK FROM transaction_date)) STORED,
    day_of_week INTEGER GENERATED ALWAYS AS (EXTRACT(DOW FROM transaction_date)) STORED,
    is_weekend BOOLEAN GENERATED ALWAYS AS (EXTRACT(DOW FROM transaction_date) IN (0, 6)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Receipts (v4.0 with OCR and semantic search)
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64) NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    thumbnail_path VARCHAR(500),
    -- OCR/Parsed data (structured)
    parsed_data JSONB,  -- Full OCR response
    extracted_merchant VARCHAR(255),
    extracted_amount DECIMAL(12,2),
    extracted_currency VARCHAR(3),
    extracted_date DATE,
    extracted_items JSONB,  -- [{"description": "Coffee", "amount": 4.50}, ...]
    -- LLM: Searchable text from receipt
    ocr_text TEXT,
    ocr_confidence DECIMAL(5,4),  -- 0.0000 to 1.0000
    -- LLM: Semantic search on receipt content
    content_embedding vector(1536),
    -- LLM: Full-text search
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(ocr_text, '') || ' ' || COALESCE(extracted_merchant, ''))
    ) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: receipts <-> expense_lines
CREATE TABLE IF NOT EXISTS receipt_line_associations (
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    line_id UUID NOT NULL REFERENCES expense_lines(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (receipt_id, line_id)
);

-- ============================================================================
-- AUDIT LOGGING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Actor information
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    actor_roles TEXT[],
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    -- Action details
    action VARCHAR(255) NOT NULL,  -- e.g., 'report.approve', 'user.role.assign'
    action_category VARCHAR(100),   -- e.g., 'authentication', 'authorization', 'workflow'
    -- Resource information
    resource_type VARCHAR(100) NOT NULL,  -- e.g., 'expense_report', 'user', 'role'
    resource_id VARCHAR(255),
    resource_version INTEGER,
    -- Changes tracking (before/after values)
    changes JSONB,  -- {"field": {"from": "old", "to": "new"}}
    -- Additional metadata
    metadata JSONB,
    -- Integrity chain (blockchain-style)
    data_hash VARCHAR(64) NOT NULL,  -- SHA-256 of event data
    chain_hash VARCHAR(64),          -- SHA-256 of previous_chain_hash + data_hash
    previous_event_id UUID REFERENCES audit_logs(event_id),
    -- Compliance flags
    is_sensitive BOOLEAN DEFAULT false,
    retention_years INTEGER DEFAULT 7
);

-- ============================================================================
-- LLM ANALYTICS TABLES
-- ============================================================================

-- Pre-aggregated spending summaries (avoids expensive aggregations)
CREATE TABLE IF NOT EXISTS spending_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Time dimensions
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    fiscal_year INTEGER,
    fiscal_quarter INTEGER,
    fiscal_month INTEGER,
    -- Scope dimensions (NULL means "all")
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    category_id UUID REFERENCES expense_categories(id) ON DELETE CASCADE,
    cost_center VARCHAR(50),
    -- Metrics
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    report_count INTEGER NOT NULL DEFAULT 0,
    avg_transaction DECIMAL(12,2),
    median_transaction DECIMAL(12,2),
    max_transaction DECIMAL(12,2),
    min_transaction DECIMAL(12,2),
    std_deviation DECIMAL(12,2),
    -- Period-over-period comparison
    prev_period_amount DECIMAL(14,2),
    amount_change DECIMAL(14,2),
    pct_change DECIMAL(7,2),  -- -999.99 to 999.99
    -- Category breakdown for this period
    category_breakdown JSONB DEFAULT '{}',  -- {"Travel": 1500, "Meals": 300}
    top_merchants JSONB DEFAULT '[]',  -- [{"name": "Hilton", "amount": 800, "count": 2}]
    -- LLM: Natural language summary
    narrative_summary TEXT,  -- "Q4 spending up 15% vs Q3, driven by increased travel"
    -- Metadata
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period_type, period_start, user_id, department_id, category_id, cost_center)
);

-- Anomaly detection results
CREATE TABLE IF NOT EXISTS expense_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Reference to flagged item
    expense_line_id UUID REFERENCES expense_lines(id) ON DELETE CASCADE,
    report_id UUID REFERENCES expense_reports(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    -- Anomaly classification
    anomaly_type VARCHAR(100) NOT NULL,  -- 'amount_outlier', 'frequency_spike', 'unusual_category', 'duplicate_suspect', 'timing_unusual'
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    confidence DECIMAL(5,4) NOT NULL,  -- 0.0000 to 1.0000
    -- Context for LLM explanation
    context JSONB NOT NULL,  -- {"expected_range": [50, 200], "actual": 850, "z_score": 3.2, "peer_avg": 120}
    explanation TEXT NOT NULL,  -- "Amount $850 is 3.2 standard deviations above typical range $50-$200 for this category"
    -- Resolution tracking
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'confirmed', 'escalated')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    -- Timestamps
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- LLM-generated insights cache
CREATE TABLE IF NOT EXISTS expense_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scope of the insight
    scope_type VARCHAR(50) NOT NULL CHECK (scope_type IN ('user', 'department', 'organization', 'category', 'report', 'global')),
    scope_id UUID,  -- NULL for global/organization insights
    -- Time range covered
    period_start DATE,
    period_end DATE,
    -- Insight content
    insight_type VARCHAR(100) NOT NULL,  -- 'trend', 'anomaly', 'recommendation', 'comparison', 'forecast', 'summary'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,  -- Natural language insight
    -- Supporting data
    supporting_data JSONB,  -- Charts, numbers, queries that back the insight
    related_entity_ids UUID[],  -- Reports/lines this insight references
    -- Quality metrics
    confidence DECIMAL(5,4),  -- 0.0000 to 1.0000
    relevance_score DECIMAL(5,4),
    -- Lifecycle
    is_pinned BOOLEAN DEFAULT false,
    is_stale BOOLEAN DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    generated_by VARCHAR(100) DEFAULT 'system',  -- 'system', 'gpt-4', 'claude-3', etc.
    -- Embedding for similar insight search
    content_embedding vector(1536)
);

-- LLM query/conversation history
CREATE TABLE IF NOT EXISTS llm_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID,  -- Group related queries
    -- Query details
    query_text TEXT NOT NULL,  -- "Show me all travel expenses over $500 last month"
    query_embedding vector(1536),
    -- Query interpretation
    parsed_intent JSONB,  -- {"action": "search", "filters": {"category": "Travel", "amount_min": 500}}
    generated_sql TEXT,  -- The SQL query generated
    -- Response
    response_text TEXT,
    response_data JSONB,  -- Structured response data
    result_count INTEGER,
    -- Feedback
    was_helpful BOOLEAN,
    user_feedback TEXT,
    -- Performance
    execution_time_ms INTEGER,
    tokens_used INTEGER,
    model_used VARCHAR(100),
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Merchant normalizations (for consistent grouping)
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_name VARCHAR(255) NOT NULL,  -- "HILTON HOTELS 12345 NYC"
    normalized_name VARCHAR(255) NOT NULL,  -- "Hilton Hotels"
    category_id UUID REFERENCES expense_categories(id),
    merchant_type VARCHAR(100),  -- 'hotel', 'airline', 'restaurant', 'gas_station'
    typical_amount_range JSONB,  -- {"min": 100, "max": 400}
    -- LLM: Embedding for fuzzy matching
    name_embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(raw_name)
);

-- Budgets for variance analysis
CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scope
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    category_id UUID REFERENCES expense_categories(id) ON DELETE CASCADE,
    cost_center VARCHAR(50),
    -- Period
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'yearly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    -- Amounts
    budget_amount DECIMAL(14,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    -- Tracking (updated by triggers/jobs)
    spent_amount DECIMAL(14,2) DEFAULT 0,
    remaining_amount DECIMAL(14,2) GENERATED ALWAYS AS (budget_amount - spent_amount) STORED,
    utilization_pct DECIMAL(7,2) GENERATED ALWAYS AS (
        CASE WHEN budget_amount > 0 THEN (spent_amount / budget_amount * 100) ELSE 0 END
    ) STORED,
    -- Alerts
    alert_threshold_pct DECIMAL(5,2) DEFAULT 80.00,
    alert_sent BOOLEAN DEFAULT false,
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, department_id, category_id, cost_center, period_type, period_start)
);

-- Expense policies (LLM: "does this expense violate policy?")
CREATE TABLE IF NOT EXISTS expense_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    description TEXT NOT NULL,  -- Human-readable policy description
    -- Scope: which expenses this policy applies to
    applies_to_categories UUID[],  -- NULL = all categories
    applies_to_departments UUID[],  -- NULL = all departments
    applies_to_roles TEXT[],  -- NULL = all roles
    -- Rule definition (machine-readable)
    rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN (
        'max_amount', 'requires_receipt', 'requires_approval', 'time_limit',
        'category_restriction', 'merchant_restriction', 'frequency_limit', 'custom'
    )),
    rule_config JSONB NOT NULL,  -- {"max_amount": 75, "currency": "USD"} or {"days_after_transaction": 30}
    -- LLM: Natural language explanation for violations
    violation_message TEXT NOT NULL,  -- "Individual meals cannot exceed $75 per company policy"
    -- Severity and enforcement
    severity VARCHAR(20) DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'hard_block')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- Metadata
    effective_date DATE,
    expiry_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- LLM prompt templates (consistent front-end LLM behavior)
CREATE TABLE IF NOT EXISTS llm_prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,  -- 'anomaly_explanation', 'monthly_summary', 'spending_comparison'
    description TEXT,
    -- Template content
    system_prompt TEXT,  -- System instructions for the LLM
    user_prompt_template TEXT NOT NULL,  -- Template with {{placeholders}}
    -- Configuration
    required_context TEXT[],  -- ['user_info', 'spending_summary', 'recent_expenses']
    output_format VARCHAR(50) DEFAULT 'text' CHECK (output_format IN ('text', 'json', 'markdown', 'chart_config')),
    -- Model preferences
    preferred_model VARCHAR(100),
    max_tokens INTEGER DEFAULT 1000,
    temperature DECIMAL(3,2) DEFAULT 0.3,
    -- Versioning
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LLM MATERIALIZED VIEWS (Pre-joined for fast retrieval)
-- ============================================================================

-- Flattened expense view for LLM queries (no joins needed)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_expense_analytics AS
SELECT
    -- Line identifiers
    el.id AS line_id,
    er.id AS report_id,
    -- User context
    u.id AS user_id,
    u.email AS user_email,
    u.display_name AS user_name,
    u.cost_center AS user_cost_center,
    -- Department context
    d.id AS department_id,
    d.name AS department_name,
    d.code AS department_code,
    d.full_path AS department_path,
    -- Manager chain
    m.id AS manager_id,
    m.display_name AS manager_name,
    -- Project/Client context
    p.id AS project_id,
    COALESCE(el.project_name, er.project_name, p.name) AS project_name,
    p.code AS project_code,
    COALESCE(el.client_name, er.client_name, p.client_name) AS client_name,
    p.client_industry,
    -- Report context
    er.title AS report_title,
    er.status AS report_status,
    er.total_amount AS report_total,
    er.submitted_at,
    er.approved_at,
    er.ai_summary AS report_summary,
    er.tags AS report_tags,
    -- Line details
    el.description,
    el.amount,
    el.currency,
    el.category,
    el.category_code,
    el.category_path,
    el.merchant_name,
    el.location_city,
    el.location_country,
    el.transaction_date,
    el.payment_method,
    el.tags AS line_tags,
    -- Recurring expense info
    el.is_recurring,
    el.recurrence_pattern,
    el.recurrence_merchant,
    -- Time dimensions
    el.fiscal_year,
    el.fiscal_quarter,
    el.fiscal_month,
    el.fiscal_week,
    el.day_of_week,
    el.is_weekend,
    DATE_TRUNC('week', el.transaction_date) AS week_start,
    DATE_TRUNC('month', el.transaction_date) AS month_start,
    DATE_TRUNC('quarter', el.transaction_date) AS quarter_start,
    -- Anomaly flags
    el.is_anomaly,
    el.anomaly_score,
    el.anomaly_reasons,
    -- Derived flags
    CASE WHEN el.amount > 500 THEN true ELSE false END AS is_high_value,
    CASE WHEN el.amount > 1000 THEN true ELSE false END AS is_very_high_value,
    -- Search vectors
    el.search_vector,
    el.description_embedding
FROM expense_lines el
JOIN expense_reports er ON el.report_id = er.id
JOIN users u ON er.user_id = u.id
LEFT JOIN departments d ON COALESCE(er.department_id, u.department_id) = d.id
LEFT JOIN users m ON u.manager_id = m.id
LEFT JOIN projects p ON COALESCE(el.project_id, er.project_id) = p.id
WHERE er.status NOT IN ('draft');  -- Only submitted+ reports

-- Create indexes on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_expense_analytics_line ON mv_expense_analytics(line_id);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_user ON mv_expense_analytics(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_dept ON mv_expense_analytics(department_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_category ON mv_expense_analytics(category, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_project ON mv_expense_analytics(project_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_client ON mv_expense_analytics(client_name, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_payment ON mv_expense_analytics(payment_method, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_recurring ON mv_expense_analytics(is_recurring, recurrence_pattern);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_tags ON mv_expense_analytics USING gin(report_tags);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_line_tags ON mv_expense_analytics USING gin(line_tags);
CREATE INDEX IF NOT EXISTS idx_mv_expense_analytics_fts ON mv_expense_analytics USING gin(search_vector);

-- User-inclusive view (includes drafts — filter by user_id at query time for security)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_expenses_all AS
SELECT
    el.id AS line_id,
    er.id AS report_id,
    u.id AS user_id,
    u.display_name AS user_name,
    er.title AS report_title,
    er.status AS report_status,
    er.total_amount AS report_total,
    COALESCE(el.project_name, er.project_name) AS project_name,
    COALESCE(el.client_name, er.client_name) AS client_name,
    el.description,
    el.amount,
    el.currency,
    el.category,
    el.category_path,
    el.merchant_name,
    el.transaction_date,
    el.payment_method,
    el.tags,
    el.is_recurring,
    el.recurrence_pattern,
    el.is_anomaly,
    el.anomaly_score,
    el.anomaly_reasons,
    el.fiscal_year,
    el.fiscal_quarter,
    el.fiscal_month,
    er.created_at AS report_created_at,
    er.submitted_at,
    el.search_vector
FROM expense_lines el
JOIN expense_reports er ON el.report_id = er.id
JOIN users u ON er.user_id = u.id;
-- NOTE: Always filter WHERE user_id = $1 at query time — this view includes drafts

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_expenses_all_line ON mv_user_expenses_all(line_id);
CREATE INDEX IF NOT EXISTS idx_mv_user_expenses_all_user ON mv_user_expenses_all(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_user_expenses_all_status ON mv_user_expenses_all(user_id, report_status);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id);
CREATE INDEX IF NOT EXISTS idx_users_roles_version ON users(id, roles_version);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

-- Refresh token indexes
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked ON refresh_tokens(revoked_at) WHERE revoked_at IS NULL;

-- RBAC indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);

-- Department indexes
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_departments_head ON departments(head_user_id);

-- Project indexes
CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(code);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_name, client_code);
CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm ON projects USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_client_trgm ON projects USING gin(client_name gin_trgm_ops);

-- Expense report indexes
CREATE INDEX IF NOT EXISTS idx_expense_reports_user_id ON expense_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_status ON expense_reports(status);
CREATE INDEX IF NOT EXISTS idx_expense_reports_workflow ON expense_reports(workflow_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_submitted ON expense_reports(submitted_at);
CREATE INDEX IF NOT EXISTS idx_expense_reports_project ON expense_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_client ON expense_reports(client_name);
CREATE INDEX IF NOT EXISTS idx_expense_reports_tags ON expense_reports USING gin(tags);

-- Expense category indexes
CREATE INDEX IF NOT EXISTS idx_expense_categories_active ON expense_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_expense_categories_code ON expense_categories(code);

-- Expense line indexes
CREATE INDEX IF NOT EXISTS idx_expense_lines_report_id ON expense_lines(report_id);
CREATE INDEX IF NOT EXISTS idx_expense_lines_category_code ON expense_lines(category_code);
CREATE INDEX IF NOT EXISTS idx_expense_lines_payment_method ON expense_lines(payment_method);
CREATE INDEX IF NOT EXISTS idx_expense_lines_project ON expense_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_expense_lines_tags ON expense_lines USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_expense_lines_recurring ON expense_lines(is_recurring, recurrence_group_id)
    WHERE is_recurring = true;
CREATE INDEX IF NOT EXISTS idx_expense_lines_recurrence_merchant ON expense_lines(recurrence_merchant, transaction_date DESC)
    WHERE is_recurring = true;

-- Receipt indexes
CREATE INDEX IF NOT EXISTS idx_receipts_report_id ON receipts(report_id);
CREATE INDEX IF NOT EXISTS idx_receipts_file_hash ON receipts(file_hash);

-- Approval history indexes
CREATE INDEX IF NOT EXISTS idx_approval_history_report ON approval_history(report_id, step_number);
CREATE INDEX IF NOT EXISTS idx_approval_history_actor ON approval_history(actor_id);

-- Workflow indexes
CREATE INDEX IF NOT EXISTS idx_workflows_active ON workflows(is_active);
CREATE INDEX IF NOT EXISTS idx_workflow_assignments_lookup ON workflow_assignments(department_id, expense_category, is_active);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_chain ON audit_logs(previous_event_id);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(action_category);

-- LLM: Vector similarity indexes (using IVFFlat for approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_expense_lines_embedding ON expense_lines 
    USING ivfflat (description_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_receipts_embedding ON receipts 
    USING ivfflat (content_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_expense_reports_embedding ON expense_reports 
    USING ivfflat (content_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_expense_categories_embedding ON expense_categories 
    USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX IF NOT EXISTS idx_merchants_embedding ON merchants 
    USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_insights_embedding ON expense_insights
    USING ivfflat (content_embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX IF NOT EXISTS idx_llm_queries_embedding ON llm_queries
    USING ivfflat (query_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_projects_embedding ON projects
    USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 50);

-- LLM: Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_expense_lines_fts ON expense_lines USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_receipts_fts ON receipts USING gin(search_vector);

-- LLM: Trigram indexes for fuzzy text matching
CREATE INDEX IF NOT EXISTS idx_expense_lines_desc_trgm ON expense_lines 
    USING gin(description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_merchants_name_trgm ON merchants 
    USING gin(normalized_name gin_trgm_ops);

-- LLM Analytics: Time-series query optimization
CREATE INDEX IF NOT EXISTS idx_expense_lines_time ON expense_lines(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_lines_fiscal ON expense_lines(fiscal_year, fiscal_quarter, fiscal_month);
CREATE INDEX IF NOT EXISTS idx_expense_lines_category_time ON expense_lines(category, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_lines_user_time ON expense_lines(report_id, transaction_date DESC);

-- LLM Analytics: Anomaly detection queries
CREATE INDEX IF NOT EXISTS idx_expense_lines_anomaly ON expense_lines(is_anomaly, anomaly_score DESC) 
    WHERE is_anomaly = true;
CREATE INDEX IF NOT EXISTS idx_anomalies_status ON expense_anomalies(status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_user ON expense_anomalies(user_id, detected_at DESC);

-- LLM Analytics: Spending summaries
CREATE INDEX IF NOT EXISTS idx_spending_summaries_lookup ON spending_summaries(
    period_type, period_start, user_id, department_id, category_id
);
CREATE INDEX IF NOT EXISTS idx_spending_summaries_time ON spending_summaries(period_type, period_start DESC);

-- LLM Analytics: Insights retrieval
CREATE INDEX IF NOT EXISTS idx_insights_scope ON expense_insights(scope_type, scope_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_type ON expense_insights(insight_type, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_active ON expense_insights(is_stale, expires_at) 
    WHERE is_stale = false;

-- LLM Query history
CREATE INDEX IF NOT EXISTS idx_llm_queries_user ON llm_queries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_queries_session ON llm_queries(session_id, created_at);

-- Budget tracking
CREATE INDEX IF NOT EXISTS idx_budgets_lookup ON budgets(user_id, department_id, period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_budgets_alerts ON budgets(alert_sent, utilization_pct DESC)
    WHERE alert_sent = false;

-- Expense policies
CREATE INDEX IF NOT EXISTS idx_policies_active ON expense_policies(is_active, rule_type);
CREATE INDEX IF NOT EXISTS idx_policies_code ON expense_policies(code);
CREATE INDEX IF NOT EXISTS idx_policies_categories ON expense_policies USING gin(applies_to_categories);
CREATE INDEX IF NOT EXISTS idx_policies_departments ON expense_policies USING gin(applies_to_departments);

-- LLM prompt templates
CREATE INDEX IF NOT EXISTS idx_prompt_templates_name ON llm_prompt_templates(name, is_active);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_reports_updated_at ON expense_reports;
CREATE TRIGGER update_expense_reports_updated_at
    BEFORE UPDATE ON expense_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_lines_updated_at ON expense_lines;
CREATE TRIGGER update_expense_lines_updated_at
    BEFORE UPDATE ON expense_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_departments_updated_at ON departments;
CREATE TRIGGER update_departments_updated_at
    BEFORE UPDATE ON departments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workflows_updated_at ON workflows;
CREATE TRIGGER update_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_categories_updated_at ON expense_categories;
CREATE TRIGGER update_expense_categories_updated_at
    BEFORE UPDATE ON expense_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_policies_updated_at ON expense_policies;
CREATE TRIGGER update_expense_policies_updated_at
    BEFORE UPDATE ON expense_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_llm_prompt_templates_updated_at ON llm_prompt_templates;
CREATE TRIGGER update_llm_prompt_templates_updated_at
    BEFORE UPDATE ON llm_prompt_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- LLM HELPER FUNCTIONS
-- ============================================================================

-- Function to refresh materialized view (call periodically or on data change)
CREATE OR REPLACE FUNCTION refresh_expense_analytics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_expense_analytics;
END;
$$ LANGUAGE plpgsql;

-- Function to compute category hierarchy path
CREATE OR REPLACE FUNCTION compute_category_path(category_id UUID)
RETURNS TEXT AS $$
DECLARE
    path TEXT := '';
    current_id UUID := category_id;
    current_name VARCHAR(100);
    parent UUID;
BEGIN
    LOOP
        SELECT name, parent_id INTO current_name, parent 
        FROM expense_categories WHERE id = current_id;
        
        IF current_name IS NULL THEN EXIT; END IF;
        
        IF path = '' THEN
            path := current_name;
        ELSE
            path := current_name || ' > ' || path;
        END IF;
        
        current_id := parent;
        IF current_id IS NULL THEN EXIT; END IF;
    END LOOP;
    
    RETURN path;
END;
$$ LANGUAGE plpgsql;

-- Function to detect amount anomalies using z-score
CREATE OR REPLACE FUNCTION detect_amount_anomaly(
    p_amount DECIMAL,
    p_category VARCHAR,
    p_user_id UUID,
    p_threshold DECIMAL DEFAULT 2.5
)
RETURNS TABLE(
    is_anomaly BOOLEAN,
    z_score DECIMAL,
    expected_range JSONB,
    explanation TEXT
) AS $$
DECLARE
    v_avg DECIMAL;
    v_stddev DECIMAL;
    v_z DECIMAL;
    v_min DECIMAL;
    v_max DECIMAL;
BEGIN
    -- Calculate stats from user's historical data for this category
    SELECT 
        AVG(el.amount), 
        STDDEV(el.amount),
        MIN(el.amount),
        MAX(el.amount)
    INTO v_avg, v_stddev, v_min, v_max
    FROM expense_lines el
    JOIN expense_reports er ON el.report_id = er.id
    WHERE er.user_id = p_user_id 
      AND el.category = p_category
      AND er.status IN ('approved', 'posted');
    
    -- Handle edge cases
    IF v_stddev IS NULL OR v_stddev = 0 THEN
        RETURN QUERY SELECT 
            false, 
            0::DECIMAL, 
            jsonb_build_object('min', v_min, 'max', v_max, 'avg', v_avg),
            'Insufficient data for anomaly detection';
        RETURN;
    END IF;
    
    v_z := (p_amount - v_avg) / v_stddev;
    
    RETURN QUERY SELECT 
        ABS(v_z) > p_threshold,
        ROUND(v_z, 2),
        jsonb_build_object(
            'min', ROUND(v_min, 2), 
            'max', ROUND(v_max, 2), 
            'avg', ROUND(v_avg, 2),
            'stddev', ROUND(v_stddev, 2)
        ),
        CASE 
            WHEN v_z > p_threshold THEN 
                format('Amount $%s is %.1f standard deviations above your average of $%s for %s', 
                       p_amount, v_z, ROUND(v_avg, 2), p_category)
            WHEN v_z < -p_threshold THEN 
                format('Amount $%s is %.1f standard deviations below your average of $%s for %s', 
                       p_amount, ABS(v_z), ROUND(v_avg, 2), p_category)
            ELSE 'Amount is within normal range'
        END;
END;
$$ LANGUAGE plpgsql;

-- Function to search expenses by semantic similarity
CREATE OR REPLACE FUNCTION semantic_expense_search(
    query_embedding vector(1536),
    limit_count INTEGER DEFAULT 10,
    user_id_filter UUID DEFAULT NULL,
    category_filter VARCHAR DEFAULT NULL,
    date_from DATE DEFAULT NULL,
    date_to DATE DEFAULT NULL
)
RETURNS TABLE(
    line_id UUID,
    report_id UUID,
    description TEXT,
    amount DECIMAL,
    category VARCHAR,
    transaction_date DATE,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        el.id,
        el.report_id,
        el.description::TEXT,
        el.amount,
        el.category,
        el.transaction_date,
        1 - (el.description_embedding <=> query_embedding) AS similarity
    FROM expense_lines el
    JOIN expense_reports er ON el.report_id = er.id
    WHERE el.description_embedding IS NOT NULL
      AND (user_id_filter IS NULL OR er.user_id = user_id_filter)
      AND (category_filter IS NULL OR el.category = category_filter)
      AND (date_from IS NULL OR el.transaction_date >= date_from)
      AND (date_to IS NULL OR el.transaction_date <= date_to)
    ORDER BY el.description_embedding <=> query_embedding
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get spending trend summary (for LLM context)
CREATE OR REPLACE FUNCTION get_spending_trend(
    p_user_id UUID,
    p_months INTEGER DEFAULT 6
)
RETURNS TABLE(
    month DATE,
    total_amount DECIMAL,
    transaction_count INTEGER,
    top_category VARCHAR,
    mom_change_pct DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    WITH monthly AS (
        SELECT 
            DATE_TRUNC('month', el.transaction_date)::DATE AS month,
            SUM(el.amount) AS total,
            COUNT(*) AS tx_count,
            MODE() WITHIN GROUP (ORDER BY el.category) AS top_cat
        FROM expense_lines el
        JOIN expense_reports er ON el.report_id = er.id
        WHERE er.user_id = p_user_id
          AND el.transaction_date >= CURRENT_DATE - (p_months || ' months')::INTERVAL
          AND er.status IN ('submitted', 'approved', 'posted')
        GROUP BY 1
    )
    SELECT 
        m.month,
        m.total,
        m.tx_count::INTEGER,
        m.top_cat,
        ROUND(((m.total - LAG(m.total) OVER (ORDER BY m.month)) / 
               NULLIF(LAG(m.total) OVER (ORDER BY m.month), 0) * 100)::DECIMAL, 1)
    FROM monthly m
    ORDER BY m.month DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to generate spending context for LLM prompts
CREATE OR REPLACE FUNCTION generate_llm_context(
    p_user_id UUID,
    p_include_recent INTEGER DEFAULT 10,
    p_include_trends BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    v_context JSONB := '{}';
    v_user_info JSONB;
    v_recent JSONB;
    v_trends JSONB;
    v_categories JSONB;
BEGIN
    -- User info
    SELECT jsonb_build_object(
        'name', display_name,
        'email', email,
        'department', (SELECT name FROM departments WHERE id = u.department_id),
        'cost_center', cost_center,
        'spending_profile', spending_profile
    ) INTO v_user_info
    FROM users u WHERE id = p_user_id;
    
    -- Recent expenses
    SELECT jsonb_agg(row_to_json(r)) INTO v_recent
    FROM (
        SELECT 
            el.description,
            el.amount,
            el.category,
            el.transaction_date,
            el.merchant_name
        FROM expense_lines el
        JOIN expense_reports er ON el.report_id = er.id
        WHERE er.user_id = p_user_id
        ORDER BY el.transaction_date DESC
        LIMIT p_include_recent
    ) r;
    
    -- Category summary (last 90 days)
    SELECT jsonb_object_agg(category, total) INTO v_categories
    FROM (
        SELECT el.category, SUM(el.amount) AS total
        FROM expense_lines el
        JOIN expense_reports er ON el.report_id = er.id
        WHERE er.user_id = p_user_id
          AND el.transaction_date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY el.category
        ORDER BY total DESC
        LIMIT 10
    ) c;
    
    -- Project spending summary (last 90 days)
    v_context := jsonb_build_object(
        'user', v_user_info,
        'recent_expenses', COALESCE(v_recent, '[]'::jsonb),
        'category_totals_90d', COALESCE(v_categories, '{}'::jsonb),
        'project_spending_90d', COALESCE((
            SELECT jsonb_object_agg(project_name, total)
            FROM (
                SELECT COALESCE(el.project_name, 'Unassigned') AS project_name, SUM(el.amount) AS total
                FROM expense_lines el
                JOIN expense_reports er ON el.report_id = er.id
                WHERE er.user_id = p_user_id
                  AND el.transaction_date >= CURRENT_DATE - INTERVAL '90 days'
                GROUP BY 1
                ORDER BY total DESC
                LIMIT 10
            ) ps
        ), '{}'::jsonb),
        'context_generated_at', CURRENT_TIMESTAMP
    );

    RETURN v_context;
END;
$$ LANGUAGE plpgsql;

-- Function to check expense against active policies (LLM: "does this violate policy?")
CREATE OR REPLACE FUNCTION check_expense_policies(
    p_amount DECIMAL,
    p_category_id UUID DEFAULT NULL,
    p_department_id UUID DEFAULT NULL,
    p_transaction_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
    policy_name VARCHAR,
    policy_code VARCHAR,
    severity VARCHAR,
    violation_message TEXT,
    rule_config JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ep.name,
        ep.code,
        ep.severity,
        ep.violation_message,
        ep.rule_config
    FROM expense_policies ep
    WHERE ep.is_active = true
      AND (ep.effective_date IS NULL OR ep.effective_date <= p_transaction_date)
      AND (ep.expiry_date IS NULL OR ep.expiry_date >= p_transaction_date)
      AND (ep.applies_to_categories IS NULL OR p_category_id = ANY(ep.applies_to_categories))
      AND (ep.applies_to_departments IS NULL OR p_department_id = ANY(ep.applies_to_departments))
      AND (
          (ep.rule_type = 'max_amount' AND p_amount > (ep.rule_config->>'max_amount')::DECIMAL)
          OR (ep.rule_type = 'requires_receipt' AND p_amount >= (ep.rule_config->>'min_amount')::DECIMAL)
          OR (ep.rule_type = 'time_limit' AND (CURRENT_DATE - p_transaction_date) > (ep.rule_config->>'days_after_transaction')::INTEGER)
      );
END;
$$ LANGUAGE plpgsql;

-- Function to refresh both materialized views
CREATE OR REPLACE FUNCTION refresh_all_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_expense_analytics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_expenses_all;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED DATA: PERMISSIONS
-- ============================================================================

INSERT INTO permissions (name, description, category, risk_level) VALUES
-- Report Management - Creation & Editing
('report.create', 'Create new expense reports', 'report', 'low'),
('report.edit.own', 'Edit own draft or returned reports', 'report', 'low'),
('report.edit.team', 'Edit subordinate reports', 'report', 'medium'),
('report.edit.all', 'Edit any report regardless of owner', 'report', 'high'),
('report.delete.own', 'Delete own draft reports', 'report', 'low'),
('report.delete.all', 'Delete any report', 'report', 'high'),
-- Report Management - Viewing
('report.view.own', 'View own reports', 'report', 'low'),
('report.view.team', 'View reports from direct subordinates', 'report', 'medium'),
('report.view.department', 'View all reports in same department', 'report', 'medium'),
('report.view.all', 'View all reports organization-wide', 'report', 'high'),
('report.view.archived', 'View archived reports', 'report', 'medium'),
-- Report Management - Workflow Actions
('report.submit', 'Submit reports for approval', 'report', 'low'),
('report.withdraw', 'Withdraw submitted reports', 'report', 'low'),
('report.approve', 'Approve reports at current workflow step', 'report', 'high'),
('report.reject', 'Reject reports permanently', 'report', 'high'),
('report.return', 'Return reports for correction', 'report', 'medium'),
('report.reassign', 'Reassign approver for a report', 'report', 'medium'),
('report.force_approve', 'Approve report bypassing workflow', 'report', 'critical'),
-- Report Management - Financial Operations
('report.post', 'Post approved reports to accounting system', 'report', 'high'),
('report.unpost', 'Reverse a posted report', 'report', 'critical'),
('report.export', 'Export report data', 'report', 'medium'),
('report.export.financial', 'Export financial data including sensitive info', 'report', 'high'),
-- Role & Permission Management
('role.create', 'Create new custom roles', 'role', 'high'),
('role.view', 'View role definitions and permissions', 'role', 'low'),
('role.edit', 'Modify existing role permissions', 'role', 'high'),
('role.delete', 'Delete custom roles', 'role', 'high'),
('role.assign', 'Assign roles to users (except Admin)', 'role', 'high'),
('role.assign.admin', 'Assign Admin role to users', 'role', 'critical'),
('role.assign.finance', 'Assign Finance role to users', 'role', 'critical'),
-- Permission Operations
('permission.view', 'View permission registry', 'permission', 'low'),
('permission.create', 'Add custom permissions to registry', 'permission', 'critical'),
('permission.edit', 'Modify permission definitions', 'permission', 'critical'),
('permission.delete', 'Remove permissions from registry', 'permission', 'critical'),
-- User Management
('user.create', 'Create new user accounts', 'user', 'medium'),
('user.view', 'View user profile information', 'user', 'low'),
('user.view.sensitive', 'View sensitive user data', 'user', 'high'),
('user.edit', 'Edit user profiles', 'user', 'medium'),
('user.edit.own', 'Edit own profile', 'user', 'low'),
('user.deactivate', 'Deactivate user accounts', 'user', 'high'),
('user.delete', 'Permanently delete user accounts', 'user', 'critical'),
('user.impersonate', 'Log in as another user for support', 'user', 'critical'),
('user.reset_password', 'Reset user passwords', 'user', 'medium'),
('user.unlock', 'Unlock locked accounts', 'user', 'low'),
-- Workflow Management
('workflow.create', 'Create new approval workflows', 'workflow', 'medium'),
('workflow.view', 'View workflow definitions', 'workflow', 'low'),
('workflow.edit', 'Modify workflow steps and rules', 'workflow', 'high'),
('workflow.delete', 'Delete workflows', 'workflow', 'high'),
('workflow.assign', 'Assign workflows to departments/types', 'workflow', 'medium'),
('workflow.test', 'Test workflows without affecting real reports', 'workflow', 'low'),
('workflow.migrate', 'Force-migrate in-flight reports to new workflow', 'workflow', 'high'),
('workflow.override', 'Override workflow rules for specific report', 'workflow', 'critical'),
-- Audit & Compliance
('audit.view', 'View audit log entries', 'audit', 'medium'),
('audit.view.all', 'View all audit logs including admin actions', 'audit', 'high'),
('audit.export', 'Export audit logs to external files', 'audit', 'medium'),
('audit.analyze', 'Run analytics on audit data', 'audit', 'medium'),
('audit.archive', 'Archive old audit logs', 'audit', 'medium'),
('compliance.view', 'View compliance reports', 'compliance', 'medium'),
('compliance.generate', 'Generate compliance reports', 'compliance', 'medium'),
('compliance.certify', 'Sign off on compliance certifications', 'compliance', 'high'),
-- Analytics
('analytics.view', 'View dashboards and reports', 'analytics', 'low'),
('analytics.view.sensitive', 'View sensitive metrics', 'analytics', 'medium'),
('analytics.export', 'Export analytics data', 'analytics', 'medium'),
('analytics.create', 'Create custom reports and dashboards', 'analytics', 'low'),
-- System Configuration
('system.configure', 'Modify system settings', 'system', 'critical'),
('system.view_logs', 'View system error and access logs', 'system', 'medium'),
('system.backup', 'Initiate system backups', 'system', 'medium'),
('system.restore', 'Restore from backups', 'system', 'critical'),
('system.integrate', 'Configure integrations', 'system', 'high'),
('system.api_keys', 'Manage API keys and webhooks', 'system', 'high'),
('system.notification', 'Configure notification settings', 'system', 'low'),
('system.maintenance', 'Enable maintenance mode', 'system', 'high'),
-- Attachment Management
('attachment.upload', 'Upload receipt attachments', 'attachment', 'low'),
('attachment.view.own', 'View own report attachments', 'attachment', 'low'),
('attachment.view.all', 'View all attachments', 'attachment', 'medium'),
('attachment.delete.own', 'Delete own attachments', 'attachment', 'low'),
('attachment.delete.all', 'Delete any attachment', 'attachment', 'high'),
('attachment.download', 'Download attachments', 'attachment', 'low'),
-- Category Management
('category.create', 'Create new expense categories', 'category', 'medium'),
('category.view', 'View expense categories', 'category', 'low'),
('category.edit', 'Edit expense categories', 'category', 'medium'),
('category.delete', 'Delete expense categories', 'category', 'high'),
-- Project Management
('project.create', 'Create new projects', 'project', 'medium'),
('project.view', 'View project details', 'project', 'low'),
('project.view.all', 'View all projects organization-wide', 'project', 'medium'),
('project.edit', 'Edit project details', 'project', 'medium'),
('project.delete', 'Delete projects', 'project', 'high'),
('project.assign', 'Assign expenses to projects', 'project', 'low'),
-- Policy Management
('policy.view', 'View expense policies', 'policy', 'low'),
('policy.create', 'Create expense policies', 'policy', 'high'),
('policy.edit', 'Edit expense policies', 'policy', 'high'),
('policy.delete', 'Delete expense policies', 'policy', 'critical'),
('policy.check', 'Run policy checks on expenses', 'policy', 'low'),
-- LLM & AI Features
('llm.query', 'Query expenses using natural language', 'llm', 'low'),
('llm.query.all', 'Query all expenses organization-wide', 'llm', 'high'),
('llm.insights.view', 'View AI-generated insights', 'llm', 'low'),
('llm.insights.generate', 'Trigger AI insight generation', 'llm', 'medium'),
('llm.anomaly.view', 'View detected anomalies', 'llm', 'medium'),
('llm.anomaly.review', 'Review and dismiss anomalies', 'llm', 'high'),
('llm.history.view', 'View own LLM query history', 'llm', 'low'),
('llm.history.view.all', 'View all users LLM queries', 'llm', 'high'),
('llm.semantic_search', 'Use semantic/vector search', 'llm', 'low'),
('llm.trends.view', 'View spending trends and analytics', 'llm', 'low'),
('llm.trends.view.all', 'View organization-wide trends', 'llm', 'high'),
('llm.forecast', 'View AI spending forecasts', 'llm', 'medium'),
('llm.budget.view', 'View budget vs actual analysis', 'llm', 'low'),
('llm.budget.manage', 'Manage budgets', 'llm', 'medium'),
('llm.policy.check', 'Check expenses against policies via LLM', 'llm', 'low'),
('llm.project.query', 'Query project spending via LLM', 'llm', 'low'),
('llm.project.query.all', 'Query all project spending organization-wide', 'llm', 'high'),
-- LLM Template Management
('llm.template.view', 'View LLM prompt templates', 'llm', 'low'),
('llm.template.create', 'Create LLM prompt templates', 'llm', 'high'),
('llm.template.edit', 'Edit LLM prompt templates', 'llm', 'high'),
('llm.template.delete', 'Delete LLM prompt templates', 'llm', 'critical')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SEED DATA: ROLES
-- ============================================================================

INSERT INTO roles (name, description, is_system) VALUES
('employee', 'Standard employee with basic expense submission capabilities', true),
('approver', 'Manager who can approve subordinate expense reports', true),
('finance', 'Finance team member with posting and reporting access', true),
('auditor', 'Read-only access to all reports and audit logs', true),
('admin', 'System administrator with full configuration access', true),
('super_admin', 'Super administrator with all permissions including admin assignment', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SEED DATA: ROLE-PERMISSION ASSIGNMENTS
-- ============================================================================

-- Employee role permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'employee' AND p.name IN (
    'report.create', 'report.edit.own', 'report.view.own', 'report.delete.own',
    'report.submit', 'report.withdraw',
    'attachment.upload', 'attachment.view.own', 'attachment.delete.own', 'attachment.download',
    'user.edit.own',
    'project.view', 'project.assign',
    'policy.view', 'policy.check',
    -- LLM permissions for employees
    'llm.query', 'llm.insights.view', 'llm.semantic_search',
    'llm.trends.view', 'llm.history.view', 'llm.budget.view',
    'llm.policy.check', 'llm.project.query'
)
ON CONFLICT DO NOTHING;

-- Approver role permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'approver' AND p.name IN (
    'report.create', 'report.edit.own', 'report.view.own', 'report.delete.own',
    'report.submit', 'report.withdraw',
    'report.view.team', 'report.approve', 'report.reject', 'report.return',
    'attachment.upload', 'attachment.view.own', 'attachment.delete.own', 'attachment.download',
    'user.view', 'user.edit.own',
    'analytics.view',
    'project.view', 'project.assign', 'project.create',
    'policy.view', 'policy.check',
    -- LLM permissions for approvers
    'llm.query', 'llm.insights.view', 'llm.insights.generate', 'llm.anomaly.view',
    'llm.semantic_search', 'llm.trends.view', 'llm.history.view', 'llm.budget.view', 'llm.forecast',
    'llm.policy.check', 'llm.project.query'
)
ON CONFLICT DO NOTHING;

-- Finance role permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'finance' AND p.name IN (
    'report.view.all', 'report.post', 'report.export', 'report.export.financial',
    'attachment.view.all', 'attachment.download',
    'audit.view',
    'analytics.view', 'analytics.export',
    'project.view', 'project.view.all', 'project.create', 'project.edit',
    'policy.view', 'policy.create', 'policy.edit', 'policy.check',
    -- LLM permissions for finance
    'llm.query', 'llm.query.all', 'llm.insights.view', 'llm.insights.generate',
    'llm.anomaly.view', 'llm.anomaly.review', 'llm.semantic_search',
    'llm.trends.view', 'llm.trends.view.all', 'llm.forecast', 'llm.budget.view', 'llm.budget.manage',
    'llm.policy.check', 'llm.project.query', 'llm.project.query.all'
)
ON CONFLICT DO NOTHING;

-- Auditor role permissions (read-only)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'auditor' AND p.name IN (
    'report.view.all', 'report.view.archived',
    'attachment.view.all', 'attachment.download',
    'audit.view', 'audit.view.all', 'audit.export', 'audit.analyze',
    'compliance.view', 'compliance.generate',
    'analytics.view',
    'project.view', 'project.view.all',
    'policy.view',
    -- LLM permissions for auditors (read-only)
    'llm.query', 'llm.query.all', 'llm.insights.view', 'llm.anomaly.view',
    'llm.semantic_search', 'llm.trends.view', 'llm.trends.view.all',
    'llm.history.view', 'llm.history.view.all', 'llm.budget.view',
    'llm.policy.check', 'llm.project.query', 'llm.project.query.all'
)
ON CONFLICT DO NOTHING;

-- Admin role permissions (most permissions except critical ones)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.name NOT IN (
    'role.assign.admin', 'role.assign.finance',
    'user.delete', 'user.impersonate',
    'system.restore', 'workflow.override', 'report.force_approve'
)
ON CONFLICT DO NOTHING;

-- Super Admin gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED DATA: SEPARATION OF DUTIES RULES
-- ============================================================================

INSERT INTO sod_rules (name, description, permission_set, risk_level) VALUES
('Approval Fraud - Edit All + Approve', 'Cannot edit any report and also approve reports',
 ARRAY['report.edit.all', 'report.approve'], 'critical'),
('Financial Bypass - Approve + Post', 'Cannot approve and also post reports',
 ARRAY['report.approve', 'report.post'], 'critical'),
('Privilege Escalation - Create Role + Assign Admin', 'Cannot create roles and assign admin role',
 ARRAY['role.create', 'role.assign.admin'], 'critical'),
('Evidence Tampering - Audit Export + Edit All', 'Cannot export audit logs and edit all reports',
 ARRAY['audit.export', 'report.edit.all'], 'critical'),
('Workflow Bypass - Override + Approve', 'Cannot override workflows and approve reports',
 ARRAY['workflow.override', 'report.approve'], 'critical'),
('Identity Fraud - Impersonate + Approve', 'Cannot impersonate users and approve reports',
 ARRAY['user.impersonate', 'report.approve'], 'critical')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED DATA: DEFAULT WORKFLOW
-- ============================================================================

INSERT INTO workflows (name, description, version, conditions, steps, on_return_policy) VALUES
('Standard Two-Level Approval', 'Default workflow: Manager approval, then Finance for amounts over $1000', 1,
 '{"amount_min": 0}',
 '[
   {
     "step_number": 1,
     "name": "Manager Approval",
     "target_type": "relationship",
     "target_value": "direct_manager",
     "sla_hours": 48,
     "required": true
   },
   {
     "step_number": 2,
     "name": "Finance Review",
     "target_type": "role",
     "target_value": "finance",
     "sla_hours": 72,
     "required_if": {"field": "total_amount", "condition": "greater_than", "value": 1000}
   }
 ]',
 'hard_restart')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED DATA: EXPENSE CATEGORIES (Hierarchical for LLM analysis)
-- ============================================================================

-- Top-level categories
INSERT INTO expense_categories (id, name, code, level, full_path, keywords, typical_amount_range) VALUES
('00000000-0000-4000-b001-000000000001', 'Travel', 'TRAVEL', 1, 'Travel', 
 ARRAY['trip', 'travel', 'journey', 'business travel'], 
 '{"min": 50, "max": 5000, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000002', 'Meals & Entertainment', 'MEALS', 1, 'Meals & Entertainment', 
 ARRAY['food', 'dining', 'restaurant', 'lunch', 'dinner', 'breakfast', 'entertainment'], 
 '{"min": 10, "max": 200, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000003', 'Office Supplies', 'OFFICE', 1, 'Office Supplies', 
 ARRAY['supplies', 'stationery', 'office', 'equipment'], 
 '{"min": 5, "max": 500, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000004', 'Technology', 'TECH', 1, 'Technology', 
 ARRAY['software', 'hardware', 'computer', 'tech', 'subscription'], 
 '{"min": 10, "max": 2000, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000005', 'Transportation', 'TRANSPORT', 1, 'Transportation', 
 ARRAY['uber', 'lyft', 'taxi', 'cab', 'rideshare', 'parking', 'gas', 'fuel'], 
 '{"min": 5, "max": 200, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000006', 'Professional Services', 'PROFSERV', 1, 'Professional Services', 
 ARRAY['consulting', 'legal', 'accounting', 'contractor'], 
 '{"min": 100, "max": 10000, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000007', 'Training & Education', 'TRAINING', 1, 'Training & Education', 
 ARRAY['course', 'conference', 'seminar', 'workshop', 'certification', 'book'], 
 '{"min": 20, "max": 5000, "currency": "USD"}'),
('00000000-0000-4000-b001-000000000008', 'Other', 'OTHER', 1, 'Other', 
 ARRAY['miscellaneous', 'other'], 
 '{"min": 1, "max": 1000, "currency": "USD"}')
ON CONFLICT (code) DO NOTHING;

-- Travel subcategories
INSERT INTO expense_categories (id, name, code, parent_id, level, full_path, keywords, typical_amount_range) VALUES
('00000000-0000-4000-b002-000000000001', 'Airfare', 'TRAVEL-AIR', '00000000-0000-4000-b001-000000000001', 2, 'Travel > Airfare', 
 ARRAY['flight', 'airline', 'plane', 'airfare', 'ticket'], 
 '{"min": 100, "max": 2000, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000002', 'Lodging', 'TRAVEL-HOTEL', '00000000-0000-4000-b001-000000000001', 2, 'Travel > Lodging', 
 ARRAY['hotel', 'motel', 'airbnb', 'accommodation', 'lodging', 'inn'], 
 '{"min": 80, "max": 400, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000003', 'Car Rental', 'TRAVEL-CAR', '00000000-0000-4000-b001-000000000001', 2, 'Travel > Car Rental', 
 ARRAY['rental', 'car rental', 'hertz', 'enterprise', 'avis'], 
 '{"min": 40, "max": 200, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000004', 'Rail & Train', 'TRAVEL-RAIL', '00000000-0000-4000-b001-000000000001', 2, 'Travel > Rail & Train', 
 ARRAY['train', 'amtrak', 'rail', 'metro'], 
 '{"min": 20, "max": 500, "currency": "USD"}')
ON CONFLICT (code) DO NOTHING;

-- Meals subcategories
INSERT INTO expense_categories (id, name, code, parent_id, level, full_path, keywords, typical_amount_range) VALUES
('00000000-0000-4000-b002-000000000005', 'Client Entertainment', 'MEALS-CLIENT', '00000000-0000-4000-b001-000000000002', 2, 'Meals & Entertainment > Client Entertainment', 
 ARRAY['client dinner', 'client lunch', 'client meeting', 'entertainment'], 
 '{"min": 50, "max": 500, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000006', 'Team Meals', 'MEALS-TEAM', '00000000-0000-4000-b001-000000000002', 2, 'Meals & Entertainment > Team Meals', 
 ARRAY['team lunch', 'team dinner', 'team building'], 
 '{"min": 30, "max": 300, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000007', 'Individual Meals', 'MEALS-SOLO', '00000000-0000-4000-b001-000000000002', 2, 'Meals & Entertainment > Individual Meals', 
 ARRAY['lunch', 'dinner', 'breakfast', 'solo meal'], 
 '{"min": 10, "max": 50, "currency": "USD"}')
ON CONFLICT (code) DO NOTHING;

-- Technology subcategories
INSERT INTO expense_categories (id, name, code, parent_id, level, full_path, keywords, typical_amount_range) VALUES
('00000000-0000-4000-b002-000000000008', 'Software & SaaS', 'TECH-SW', '00000000-0000-4000-b001-000000000004', 2, 'Technology > Software & SaaS', 
 ARRAY['software', 'saas', 'subscription', 'license', 'app'], 
 '{"min": 10, "max": 500, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000009', 'Hardware', 'TECH-HW', '00000000-0000-4000-b001-000000000004', 2, 'Technology > Hardware', 
 ARRAY['laptop', 'monitor', 'keyboard', 'mouse', 'hardware', 'equipment'], 
 '{"min": 50, "max": 3000, "currency": "USD"}'),
('00000000-0000-4000-b002-000000000010', 'Cloud Services', 'TECH-CLOUD', '00000000-0000-4000-b001-000000000004', 2, 'Technology > Cloud Services', 
 ARRAY['aws', 'azure', 'gcp', 'cloud', 'hosting'], 
 '{"min": 20, "max": 1000, "currency": "USD"}')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SEED DATA: DEPARTMENTS
-- ============================================================================

INSERT INTO departments (id, name, code, level, full_path) VALUES
('00000000-0000-4000-c001-000000000001', 'Engineering', 'ENG', 1, 'Engineering'),
('00000000-0000-4000-c001-000000000002', 'Sales', 'SALES', 1, 'Sales'),
('00000000-0000-4000-c001-000000000003', 'Finance', 'FIN', 1, 'Finance'),
('00000000-0000-4000-c001-000000000004', 'Human Resources', 'HR', 1, 'Human Resources'),
('00000000-0000-4000-c001-000000000005', 'Marketing', 'MKT', 1, 'Marketing')
ON CONFLICT (code) DO NOTHING;

INSERT INTO departments (id, name, code, parent_id, level, full_path) VALUES
('00000000-0000-4000-c002-000000000001', 'Backend', 'ENG-BE', '00000000-0000-4000-c001-000000000001', 2, 'Engineering > Backend'),
('00000000-0000-4000-c002-000000000002', 'Frontend', 'ENG-FE', '00000000-0000-4000-c001-000000000001', 2, 'Engineering > Frontend'),
('00000000-0000-4000-c002-000000000003', 'DevOps', 'ENG-DEVOPS', '00000000-0000-4000-c001-000000000001', 2, 'Engineering > DevOps'),
('00000000-0000-4000-c002-000000000004', 'North America', 'SALES-NA', '00000000-0000-4000-c001-000000000002', 2, 'Sales > North America'),
('00000000-0000-4000-c002-000000000005', 'EMEA', 'SALES-EMEA', '00000000-0000-4000-c001-000000000002', 2, 'Sales > EMEA')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SEED DATA: PROJECTS
-- ============================================================================

INSERT INTO projects (id, name, code, description, client_name, client_code, client_industry, department_id, status, budget_amount, start_date, end_date, tags, full_path) VALUES
('00000000-0000-4000-d001-000000000001', 'Project Alpha', 'PROJ-ALPHA', 'Cloud migration for Acme Corp ERP system', 'Acme Corporation', 'ACME', 'Manufacturing', '00000000-0000-4000-c001-000000000001', 'active', 250000.00, '2025-01-15', '2025-12-31', ARRAY['cloud-migration', 'high-priority', 'billable'], 'Acme Corporation > Project Alpha'),
('00000000-0000-4000-d001-000000000002', 'Project Beta', 'PROJ-BETA', 'Mobile app development for GlobalTech', 'GlobalTech Solutions', 'GTECH', 'Technology', '00000000-0000-4000-c002-000000000002', 'active', 180000.00, '2025-03-01', '2025-11-30', ARRAY['mobile', 'react-native', 'billable'], 'GlobalTech Solutions > Project Beta'),
('00000000-0000-4000-d001-000000000003', 'Project Gamma', 'PROJ-GAMMA', 'Data analytics platform for Meridian Health', 'Meridian Health Systems', 'MHS', 'Healthcare', '00000000-0000-4000-c002-000000000001', 'active', 320000.00, '2025-02-01', '2026-06-30', ARRAY['data-analytics', 'hipaa', 'billable', 'long-term'], 'Meridian Health Systems > Project Gamma'),
('00000000-0000-4000-d001-000000000004', 'Internal DevOps Modernization', 'PROJ-DEVOPS', 'Internal CI/CD pipeline overhaul', NULL, NULL, NULL, '00000000-0000-4000-c002-000000000003', 'active', 75000.00, '2025-04-01', '2025-09-30', ARRAY['internal', 'infrastructure', 'non-billable'], 'Internal > DevOps Modernization'),
('00000000-0000-4000-d001-000000000005', 'Sales Summit 2025', 'PROJ-SUMMIT', 'Annual sales conference and client events', NULL, NULL, NULL, '00000000-0000-4000-c001-000000000002', 'active', 120000.00, '2025-06-01', '2025-06-30', ARRAY['event', 'annual', 'non-billable'], 'Internal > Sales Summit 2025'),
('00000000-0000-4000-d001-000000000006', 'Project Delta', 'PROJ-DELTA', 'API integration for Pinnacle Financial', 'Pinnacle Financial Group', 'PFG', 'Financial Services', '00000000-0000-4000-c002-000000000001', 'completed', 95000.00, '2024-08-01', '2025-02-28', ARRAY['api', 'fintech', 'billable', 'completed'], 'Pinnacle Financial Group > Project Delta')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SEED DATA: EXPENSE POLICIES
-- ============================================================================

INSERT INTO expense_policies (name, code, description, rule_type, rule_config, violation_message, severity, is_active, effective_date) VALUES
('Individual Meal Limit', 'POL-MEAL-LIMIT', 'Individual meals cannot exceed $75 per person', 'max_amount', '{"max_amount": 75, "currency": "USD"}', 'Individual meals cannot exceed $75 per person per company policy. Please submit justification for amounts over this limit.', 'warning', true, '2025-01-01'),
('Receipt Required Over $25', 'POL-RECEIPT-25', 'Receipts are required for all expenses over $25', 'requires_receipt', '{"min_amount": 25, "currency": "USD"}', 'A receipt is required for expenses over $25. Please attach a receipt to this expense.', 'warning', true, '2025-01-01'),
('30-Day Submission Window', 'POL-TIME-30D', 'Expenses must be submitted within 30 days of the transaction date', 'time_limit', '{"days_after_transaction": 30}', 'This expense is more than 30 days old. Late submissions require manager approval and justification.', 'warning', true, '2025-01-01'),
('Hotel Nightly Rate Cap', 'POL-HOTEL-CAP', 'Hotel rates cannot exceed $350 per night in standard markets', 'max_amount', '{"max_amount": 350, "currency": "USD"}', 'Hotel rate exceeds $350/night cap. High-cost city exceptions require pre-approval from Finance.', 'warning', true, '2025-01-01'),
('Airfare Advance Booking', 'POL-AIR-ADVANCE', 'Flights over $800 require advance booking justification', 'max_amount', '{"max_amount": 800, "currency": "USD"}', 'Airfare exceeds $800. Please document why advance booking was not possible for a lower fare.', 'warning', true, '2025-01-01'),
('Client Entertainment Limit', 'POL-CLIENT-ENT', 'Client entertainment cannot exceed $150 per attendee', 'max_amount', '{"max_amount": 150, "currency": "USD"}', 'Client entertainment exceeds $150 per attendee limit. VP approval required for higher amounts.', 'hard_block', true, '2025-01-01')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SEED DATA: LLM PROMPT TEMPLATES
-- ============================================================================

INSERT INTO llm_prompt_templates (name, description, system_prompt, user_prompt_template, required_context, output_format, max_tokens, temperature) VALUES
('monthly_summary', 'Generate a natural language monthly spending summary',
 'You are a financial analysis assistant for an expense management system. Be concise, data-driven, and highlight notable patterns.',
 'Summarize the spending for {{user_name}} in {{period}}. Total: ${{total_amount}} across {{transaction_count}} transactions. Category breakdown: {{category_breakdown}}. Previous period: ${{prev_period_amount}} ({{pct_change}}% change). Top merchants: {{top_merchants}}.',
 ARRAY['user_info', 'spending_summary'], 'text', 500, 0.3),

('anomaly_explanation', 'Explain a detected spending anomaly in plain language',
 'You are a fraud/anomaly detection assistant. Explain anomalies clearly without alarming language. Suggest possible legitimate explanations first.',
 'Explain this anomaly for {{user_name}}: {{anomaly_type}} detected on expense "${{description}}" for ${{amount}} in category {{category}}. Context: {{context}}. Historical average: ${{avg_amount}}, std deviation: ${{std_dev}}.',
 ARRAY['user_info', 'anomaly_context', 'historical_stats'], 'text', 300, 0.2),

('spending_comparison', 'Compare spending between two periods or entities',
 'You are a financial analysis assistant. Compare spending data objectively, highlighting significant differences and possible causes.',
 'Compare spending for {{scope_name}}: Period 1 ({{period_1}}): ${{amount_1}}, {{count_1}} transactions. Period 2 ({{period_2}}): ${{amount_2}}, {{count_2}} transactions. Category changes: {{category_diff}}. Notable changes: {{notable_changes}}.',
 ARRAY['spending_summary', 'comparison_data'], 'text', 600, 0.3),

('expense_forecast', 'Forecast future spending based on historical patterns',
 'You are a financial forecasting assistant. Base predictions on historical trends and note confidence levels.',
 'Forecast spending for {{user_name}} for {{forecast_period}} based on {{months_of_data}} months of history. Monthly trend: {{monthly_trend}}. Seasonal patterns: {{seasonal_data}}. Recurring expenses: {{recurring_total}}/month.',
 ARRAY['user_info', 'spending_summary', 'recurring_expenses'], 'json', 400, 0.2),

('policy_check_explanation', 'Explain policy violations in user-friendly language',
 'You are a helpful expense policy assistant. Explain violations clearly, offer actionable next steps, and reference specific policy details.',
 'The expense "${{description}}" for ${{amount}} in category {{category}} triggered the following policy: {{policy_name}} — {{violation_message}}. Suggest how {{user_name}} can resolve this.',
 ARRAY['expense_details', 'policy_info'], 'text', 300, 0.2),

('project_spending_report', 'Summarize spending against a project budget',
 'You are a project financial analyst. Focus on budget utilization, burn rate, and remaining runway.',
 'Project: {{project_name}} (Client: {{client_name}}). Budget: ${{budget_amount}}, Spent: ${{spent_amount}} ({{utilization_pct}}%). Timeline: {{start_date}} to {{end_date}}. Category breakdown: {{category_breakdown}}. Monthly burn rate: ${{monthly_burn}}. Top expenses: {{top_expenses}}.',
 ARRAY['project_info', 'spending_summary'], 'text', 500, 0.3),

('natural_language_query', 'Parse and respond to a natural language expense query',
 'You are an expense query assistant. Parse the user''s natural language question into structured filters. Respond with data-backed answers. If the query is ambiguous, ask for clarification.',
 '{{query_text}}',
 ARRAY['user_info', 'available_filters'], 'json', 800, 0.1)

ON CONFLICT (name) DO NOTHING;
