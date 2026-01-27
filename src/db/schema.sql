-- Expense API Database Schema v3.0
-- PostgreSQL 15+ (native SQL, no ORM)
-- Includes: RBAC, Audit Logging, Workflow Engine, Security Enhancements

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Departments (created first for FK references)
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    head_user_id UUID,  -- FK added after users table
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users table (v3.0 enhanced)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255),
    password_hash VARCHAR(255),  -- NULL if OAuth-only user
    oauth_provider VARCHAR(50),  -- 'google', 'facebook', or NULL
    oauth_id VARCHAR(255),
    -- v3.0 security fields
    roles_version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    -- organizational hierarchy
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    cost_center VARCHAR(50),
    -- timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add FK from departments to users (head_user_id)
ALTER TABLE departments ADD CONSTRAINT fk_departments_head
    FOREIGN KEY (head_user_id) REFERENCES users(id) ON DELETE SET NULL;

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
    name VARCHAR(255) NOT NULL,
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
    name VARCHAR(255) NOT NULL,
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

-- Expense reports
CREATE TABLE IF NOT EXISTS expense_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'pending', 'approved', 'rejected', 'returned', 'posted')),
    -- v3.0 workflow fields
    department_id UUID REFERENCES departments(id),
    cost_center VARCHAR(50),
    total_amount DECIMAL(12,2),
    currency VARCHAR(3) DEFAULT 'USD',
    workflow_id UUID REFERENCES workflows(id),
    workflow_snapshot JSONB,  -- Frozen workflow at submission
    current_step INTEGER,
    submitted_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    posted_at TIMESTAMP WITH TIME ZONE,
    version INTEGER NOT NULL DEFAULT 1,
    -- timestamps
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

-- Expense lines
CREATE TABLE IF NOT EXISTS expense_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    currency VARCHAR(3) DEFAULT 'USD',
    category VARCHAR(100),
    expense_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Receipts
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 for deduplication
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    parsed_data JSONB,  -- OCR/parsed receipt data from receipt-parser
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

-- Expense report indexes
CREATE INDEX IF NOT EXISTS idx_expense_reports_user_id ON expense_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_status ON expense_reports(status);
CREATE INDEX IF NOT EXISTS idx_expense_reports_workflow ON expense_reports(workflow_id);
CREATE INDEX IF NOT EXISTS idx_expense_reports_submitted ON expense_reports(submitted_at);

-- Expense line indexes
CREATE INDEX IF NOT EXISTS idx_expense_lines_report_id ON expense_lines(report_id);

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
('attachment.download', 'Download attachments', 'attachment', 'low')
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
    'user.edit.own'
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
    'analytics.view'
)
ON CONFLICT DO NOTHING;

-- Finance role permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'finance' AND p.name IN (
    'report.view.all', 'report.post', 'report.export', 'report.export.financial',
    'attachment.view.all', 'attachment.download',
    'audit.view',
    'analytics.view', 'analytics.export'
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
    'analytics.view'
)
ON CONFLICT DO NOTHING;

-- Admin role permissions (most permissions except critical ones)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.name NOT IN (
    'role.assign.admin', 'role.assign.finance',
    'permission.create', 'permission.edit', 'permission.delete',
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
