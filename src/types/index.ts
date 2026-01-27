export interface User {
  id: string;
  email: string;
  username: string | null;
  password_hash: string | null;
  oauth_provider: string | null;
  oauth_id: string | null;
  roles_version: number;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  department_id: string | null;
  manager_id: string | null;
  cost_center: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  ip_address: string | null;
  user_agent: string | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

export type ExpenseReportStatus = 'draft' | 'submitted' | 'pending' | 'approved' | 'rejected' | 'returned' | 'posted';

export interface ExpenseReport {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: ExpenseReportStatus;
  department_id: string | null;
  cost_center: string | null;
  total_amount: string | null;
  currency: string;
  workflow_id: string | null;
  workflow_snapshot: WorkflowDefinition | null;
  current_step: number | null;
  submitted_at: Date | null;
  approved_at: Date | null;
  posted_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseLine {
  id: string;
  report_id: string;
  description: string;
  amount: string; // DECIMAL comes as string from pg
  currency: string;
  category: string | null;
  expense_date: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Receipt {
  id: string;
  report_id: string;
  file_path: string;
  file_name: string;
  file_hash: string;
  mime_type: string;
  file_size: number;
  parsed_data: Record<string, unknown> | null;
  created_at: Date;
}

export interface ReceiptLineAssociation {
  receipt_id: string;
  line_id: string;
  created_at: Date;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ParsedReceiptData {
  vendor?: string;
  date?: string;
  total?: number;
  currency?: string;
  items?: Array<{
    description: string;
    amount: number;
  }>;
  raw_text?: string;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public details?: unknown) {
    super(400, message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

// ============================================================================
// V3.0 Types: RBAC, Workflows, and Audit
// ============================================================================

// Roles and Permissions
export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Permission {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  risk_level: PermissionRiskLevel | null;
  requires_mfa: boolean;
  created_at: Date;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  assigned_at: Date;
  assigned_by: string | null;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
  granted_at: Date;
  granted_by: string | null;
}

// Department hierarchy
export interface Department {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  head_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// Workflow types
export interface WorkflowStepCondition {
  field: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals' | 'in' | 'not_in';
  value: unknown;
}

export interface WorkflowStep {
  step_number: number;
  name: string;
  target_type: 'role' | 'relationship' | 'hybrid' | 'system';
  target_value: string | { role: string; relationship: string };
  sla_hours: number;
  required?: boolean;
  required_if?: WorkflowStepCondition;
  skip_if?: WorkflowStepCondition;
  escalation?: {
    enabled: boolean;
    target_type: string;
    target_value: string;
    notify_at_hours: number[];
    auto_approve_after_hours?: number | null;
  };
}

export interface WorkflowConditions {
  amount_min?: number;
  amount_max?: number;
  expense_categories?: string[];
  departments?: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
  conditions: WorkflowConditions | null;
  steps: WorkflowStep[];
  on_return_policy: 'hard_restart' | 'soft_restart';
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
}

export interface WorkflowAssignment {
  id: string;
  workflow_id: string;
  department_id: string | null;
  expense_category: string | null;
  amount_min: string | null;
  amount_max: string | null;
  priority: number;
  is_active: boolean;
  created_at: Date;
}

export type ApprovalAction = 'approve' | 'reject' | 'return' | 'escalate' | 'auto_approve';

export interface ApprovalHistory {
  id: string;
  report_id: string;
  step_number: number;
  step_name: string | null;
  actor_id: string | null;
  actor_email: string | null;
  action: ApprovalAction;
  comment: string | null;
  rejection_category: string | null;
  report_hash: string | null;
  created_at: Date;
  sla_deadline: Date | null;
  was_escalated: boolean;
}

// Separation of Duties
export interface SodRule {
  id: string;
  name: string;
  description: string | null;
  permission_set: string[];
  risk_level: string;
  is_active: boolean;
  created_at: Date;
}

// Audit logging
export type AuditActionCategory = 'authentication' | 'authorization' | 'workflow' | 'data' | 'system' | 'compliance';

export interface AuditLogChanges {
  [field: string]: {
    from: unknown;
    to: unknown;
  };
}

export interface AuditLog {
  id: string;
  event_id: string;
  timestamp: Date;
  actor_id: string | null;
  actor_email: string | null;
  actor_roles: string[] | null;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  action: string;
  action_category: AuditActionCategory | null;
  resource_type: string;
  resource_id: string | null;
  resource_version: number | null;
  changes: AuditLogChanges | null;
  metadata: Record<string, unknown> | null;
  data_hash: string;
  chain_hash: string | null;
  previous_event_id: string | null;
  is_sensitive: boolean;
  retention_years: number;
}

// Enhanced JWT payload for v3.0
export interface JwtPayloadV3 {
  jti: string;          // JWT ID (unique identifier)
  sub: string;          // User ID
  email: string;
  username: string | null;
  roles: string[];      // Role names
  roles_version: number; // For session invalidation on role change
  permissions: string[]; // Flattened permission list
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  refresh_token_id?: string; // Only in access tokens, references the refresh token
}

// User with roles and permissions (for auth context)
export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
  roles: string[];
  roles_version: number;
  permissions: string[];
  department_id: string | null;
  manager_id: string | null;
}

// SoD validation result
export interface SodValidationResult {
  valid: boolean;
  violations: Array<{
    rule_name: string;
    description: string;
    conflicting_permissions: string[];
  }>;
}

// Permission check result
export interface PermissionCheckResult {
  allowed: boolean;
  missing_permissions?: string[];
  reason?: string;
}

// Self-approval check result
export interface SelfApprovalCheckResult {
  allowed: boolean;
  reason?: string;
  check_type?: 'direct_self' | 'circular' | 'same_entity' | 'temporal';
}
