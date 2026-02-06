-- Migration 001: Fix vector dimensions from 1536 (OpenAI) to 768 (nomic-embed-text)
--
-- SAFE TO RUN: All embedding columns are currently NULL (no data loss).
-- Must be run BEFORE any embeddings are generated.
--
-- Affected: 8 table columns, 8 IVFFlat indexes, 1 function, 1 materialized view
--
-- Run with: psql -U expense_user -d expense_db -f src/db/migrations/001-fix-vector-dimensions.sql

BEGIN;

-- ============================================================================
-- 1. Drop the materialized view that depends on expense_lines.description_embedding
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_expense_analytics;

-- ============================================================================
-- 2. Drop IVFFlat indexes (cannot alter column type with index present)
-- ============================================================================

DROP INDEX IF EXISTS idx_expense_lines_embedding;
DROP INDEX IF EXISTS idx_receipts_embedding;
DROP INDEX IF EXISTS idx_expense_reports_embedding;
DROP INDEX IF EXISTS idx_expense_categories_embedding;
DROP INDEX IF EXISTS idx_merchants_embedding;
DROP INDEX IF EXISTS idx_insights_embedding;
DROP INDEX IF EXISTS idx_llm_queries_embedding;
DROP INDEX IF EXISTS idx_projects_embedding;

-- ============================================================================
-- 3. Alter vector column dimensions: 1536 → 768
-- ============================================================================

-- projects.name_embedding (line 76 in schema.sql)
ALTER TABLE projects ALTER COLUMN name_embedding TYPE vector(768);

-- expense_reports.content_embedding (line 268)
ALTER TABLE expense_reports ALTER COLUMN content_embedding TYPE vector(768);

-- expense_categories.name_embedding (line 309)
ALTER TABLE expense_categories ALTER COLUMN name_embedding TYPE vector(768);

-- expense_lines.description_embedding (line 347)
ALTER TABLE expense_lines ALTER COLUMN description_embedding TYPE vector(768);

-- receipts.content_embedding (line 390)
ALTER TABLE receipts ALTER COLUMN content_embedding TYPE vector(768);

-- expense_insights.content_embedding (line 533)
ALTER TABLE expense_insights ALTER COLUMN content_embedding TYPE vector(768);

-- llm_queries.query_embedding (line 543)
ALTER TABLE llm_queries ALTER COLUMN query_embedding TYPE vector(768);

-- merchants.name_embedding (line 571)
ALTER TABLE merchants ALTER COLUMN name_embedding TYPE vector(768);

-- ============================================================================
-- 4. Recreate IVFFlat indexes with correct dimensions
-- ============================================================================

CREATE INDEX idx_expense_lines_embedding ON expense_lines
    USING ivfflat (description_embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_receipts_embedding ON receipts
    USING ivfflat (content_embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_expense_reports_embedding ON expense_reports
    USING ivfflat (content_embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_expense_categories_embedding ON expense_categories
    USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX idx_merchants_embedding ON merchants
    USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_insights_embedding ON expense_insights
    USING ivfflat (content_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX idx_llm_queries_embedding ON llm_queries
    USING ivfflat (query_embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_projects_embedding ON projects
    USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 50);

-- ============================================================================
-- 5. Update semantic_expense_search() function parameter type
-- ============================================================================

CREATE OR REPLACE FUNCTION semantic_expense_search(
    query_embedding vector(768),
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

-- ============================================================================
-- 6. Recreate mv_expense_analytics materialized view
-- ============================================================================

CREATE MATERIALIZED VIEW mv_expense_analytics AS
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
WHERE er.status NOT IN ('draft');

-- Indexes on materialized view
CREATE UNIQUE INDEX idx_mv_expense_analytics_line ON mv_expense_analytics(line_id);
CREATE INDEX idx_mv_expense_analytics_user ON mv_expense_analytics(user_id, transaction_date DESC);
CREATE INDEX idx_mv_expense_analytics_dept ON mv_expense_analytics(department_id, transaction_date DESC);
CREATE INDEX idx_mv_expense_analytics_category ON mv_expense_analytics(category, transaction_date DESC);
CREATE INDEX idx_mv_expense_analytics_project ON mv_expense_analytics(project_id, transaction_date DESC);
CREATE INDEX idx_mv_expense_analytics_client ON mv_expense_analytics(client_name, transaction_date DESC);
CREATE INDEX idx_mv_expense_analytics_payment ON mv_expense_analytics(payment_method, transaction_date DESC);
CREATE INDEX idx_mv_expense_analytics_recurring ON mv_expense_analytics(is_recurring, recurrence_pattern);
CREATE INDEX idx_mv_expense_analytics_tags ON mv_expense_analytics USING gin(report_tags);
CREATE INDEX idx_mv_expense_analytics_line_tags ON mv_expense_analytics USING gin(line_tags);
CREATE INDEX idx_mv_expense_analytics_fts ON mv_expense_analytics USING gin(search_vector);

COMMIT;
