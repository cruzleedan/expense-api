import { query } from '../db/client.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  type PaginationParams,
} from '../utils/pagination.js';

export type RuleType = 'max_amount' | 'requires_receipt' | 'requires_approval' | 'time_limit' |
  'category_restriction' | 'merchant_restriction' | 'frequency_limit' | 'custom';

export type Severity = 'info' | 'warning' | 'hard_block';

export interface ExpensePolicy {
  id: string;
  name: string;
  code: string | null;
  description: string;
  applies_to_categories: string[] | null;
  applies_to_departments: string[] | null;
  applies_to_roles: string[] | null;
  rule_type: RuleType;
  rule_config: Record<string, unknown>;
  violation_message: string;
  severity: Severity;
  is_active: boolean;
  effective_date: Date | null;
  expiry_date: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
}

export interface CreateExpensePolicyInput {
  name: string;
  code?: string;
  description: string;
  appliesToCategories?: string[];
  appliesToDepartments?: string[];
  appliesToRoles?: string[];
  ruleType: RuleType;
  ruleConfig: Record<string, unknown>;
  violationMessage: string;
  severity?: Severity;
  isActive?: boolean;
  effectiveDate?: string;
  expiryDate?: string;
}

export interface UpdateExpensePolicyInput {
  name?: string;
  code?: string | null;
  description?: string;
  appliesToCategories?: string[] | null;
  appliesToDepartments?: string[] | null;
  appliesToRoles?: string[] | null;
  ruleType?: RuleType;
  ruleConfig?: Record<string, unknown>;
  violationMessage?: string;
  severity?: Severity;
  isActive?: boolean;
  effectiveDate?: string | null;
  expiryDate?: string | null;
}

export interface ListPoliciesFilters {
  isActive?: boolean;
  ruleType?: RuleType;
  severity?: Severity;
}

const POLICY_SORTABLE_FIELDS = ['name', 'code', 'rule_type', 'severity', 'effective_date', 'created_at', 'updated_at'];
const POLICY_SEARCHABLE_FIELDS = ['name', 'code', 'description', 'violation_message'];

export async function createExpensePolicy(
  input: CreateExpensePolicyInput,
  createdBy?: string
): Promise<ExpensePolicy> {
  if (input.code) {
    const existing = await query<ExpensePolicy>(
      'SELECT id FROM expense_policies WHERE code = $1',
      [input.code]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError(`Policy with code "${input.code}" already exists`);
    }
  }

  const result = await query<ExpensePolicy>(
    `INSERT INTO expense_policies (
      name, code, description, applies_to_categories, applies_to_departments, applies_to_roles,
      rule_type, rule_config, violation_message, severity, is_active,
      effective_date, expiry_date, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      input.name,
      input.code ?? null,
      input.description,
      input.appliesToCategories ?? null,
      input.appliesToDepartments ?? null,
      input.appliesToRoles ?? null,
      input.ruleType,
      JSON.stringify(input.ruleConfig),
      input.violationMessage,
      input.severity ?? 'warning',
      input.isActive ?? true,
      input.effectiveDate ?? null,
      input.expiryDate ?? null,
      createdBy ?? null
    ]
  );

  return result.rows[0];
}

export async function getExpensePolicyById(policyId: string): Promise<ExpensePolicy> {
  const result = await query<ExpensePolicy>(
    'SELECT * FROM expense_policies WHERE id = $1',
    [policyId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Expense policy');
  }

  return result.rows[0];
}

export async function listExpensePolicies(
  params: PaginationParams,
  filters?: ListPoliciesFilters
): Promise<{ policies: ExpensePolicy[]; total: number }> {
  const offset = getOffset(params);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.isActive !== undefined) {
    conditions.push(`is_active = $${paramIndex}`);
    values.push(filters.isActive);
    paramIndex++;
  }

  if (filters?.ruleType) {
    conditions.push(`rule_type = $${paramIndex}`);
    values.push(filters.ruleType);
    paramIndex++;
  }

  if (filters?.severity) {
    conditions.push(`severity = $${paramIndex}`);
    values.push(filters.severity);
    paramIndex++;
  }

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    POLICY_SEARCHABLE_FIELDS,
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY clause
  const orderBy = buildOrderByClause(
    params,
    POLICY_SORTABLE_FIELDS,
    'name ASC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<ExpensePolicy>(
      `SELECT * FROM expense_policies ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM expense_policies ${whereClause}`,
      values
    ),
  ]);

  return {
    policies: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateExpensePolicy(
  policyId: string,
  input: UpdateExpensePolicyInput
): Promise<ExpensePolicy> {
  const existing = await getExpensePolicyById(policyId);

  if (input.code && input.code !== existing.code) {
    const codeCheck = await query<ExpensePolicy>(
      'SELECT id FROM expense_policies WHERE code = $1 AND id != $2',
      [input.code, policyId]
    );
    if (codeCheck.rows.length > 0) {
      throw new ConflictError(`Policy with code "${input.code}" already exists`);
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    values.push(input.name);
    paramIndex++;
  }

  if (input.code !== undefined) {
    updates.push(`code = $${paramIndex}`);
    values.push(input.code);
    paramIndex++;
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    values.push(input.description);
    paramIndex++;
  }

  if (input.appliesToCategories !== undefined) {
    updates.push(`applies_to_categories = $${paramIndex}`);
    values.push(input.appliesToCategories);
    paramIndex++;
  }

  if (input.appliesToDepartments !== undefined) {
    updates.push(`applies_to_departments = $${paramIndex}`);
    values.push(input.appliesToDepartments);
    paramIndex++;
  }

  if (input.appliesToRoles !== undefined) {
    updates.push(`applies_to_roles = $${paramIndex}`);
    values.push(input.appliesToRoles);
    paramIndex++;
  }

  if (input.ruleType !== undefined) {
    updates.push(`rule_type = $${paramIndex}`);
    values.push(input.ruleType);
    paramIndex++;
  }

  if (input.ruleConfig !== undefined) {
    updates.push(`rule_config = $${paramIndex}`);
    values.push(JSON.stringify(input.ruleConfig));
    paramIndex++;
  }

  if (input.violationMessage !== undefined) {
    updates.push(`violation_message = $${paramIndex}`);
    values.push(input.violationMessage);
    paramIndex++;
  }

  if (input.severity !== undefined) {
    updates.push(`severity = $${paramIndex}`);
    values.push(input.severity);
    paramIndex++;
  }

  if (input.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.isActive);
    paramIndex++;
  }

  if (input.effectiveDate !== undefined) {
    updates.push(`effective_date = $${paramIndex}`);
    values.push(input.effectiveDate);
    paramIndex++;
  }

  if (input.expiryDate !== undefined) {
    updates.push(`expiry_date = $${paramIndex}`);
    values.push(input.expiryDate);
    paramIndex++;
  }

  if (updates.length === 0) {
    return existing;
  }

  values.push(policyId);

  const result = await query<ExpensePolicy>(
    `UPDATE expense_policies SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteExpensePolicy(policyId: string): Promise<void> {
  await getExpensePolicyById(policyId);
  await query('DELETE FROM expense_policies WHERE id = $1', [policyId]);
}

// Get active policies that apply to a given expense
export interface PolicyCheckContext {
  categoryId?: string;
  departmentId?: string;
  userRoles?: string[];
  amount?: number;
  transactionDate?: string;
  merchantName?: string;
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  ruleType: RuleType;
  severity: Severity;
  violationMessage: string;
}

export async function checkPoliciesForExpense(
  context: PolicyCheckContext
): Promise<PolicyViolation[]> {
  // Get active policies that could apply
  const activePolicies = await query<ExpensePolicy>(
    `SELECT * FROM expense_policies
     WHERE is_active = true
     AND (effective_date IS NULL OR effective_date <= CURRENT_DATE)
     AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)`,
    []
  );

  const violations: PolicyViolation[] = [];

  for (const policy of activePolicies.rows) {
    // Check if policy applies to this context
    const categoryApplies = !policy.applies_to_categories ||
      (context.categoryId && policy.applies_to_categories.includes(context.categoryId));

    const departmentApplies = !policy.applies_to_departments ||
      (context.departmentId && policy.applies_to_departments.includes(context.departmentId));

    const roleApplies = !policy.applies_to_roles ||
      (context.userRoles && context.userRoles.some(r => policy.applies_to_roles?.includes(r)));

    if (!categoryApplies || !departmentApplies || !roleApplies) {
      continue;
    }

    // Check the rule
    let violated = false;
    const config = policy.rule_config;

    switch (policy.rule_type) {
      case 'max_amount':
        if (context.amount && config.max_amount && context.amount > (config.max_amount as number)) {
          violated = true;
        }
        break;
      case 'requires_receipt':
        // This would be checked elsewhere with receipt info
        break;
      case 'time_limit':
        if (context.transactionDate && config.days_after_transaction) {
          const txDate = new Date(context.transactionDate);
          const now = new Date();
          const daysDiff = Math.floor((now.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > (config.days_after_transaction as number)) {
            violated = true;
          }
        }
        break;
      case 'merchant_restriction':
        if (context.merchantName && config.blocked_merchants) {
          const blockedMerchants = config.blocked_merchants as string[];
          if (blockedMerchants.some(m => context.merchantName?.toLowerCase().includes(m.toLowerCase()))) {
            violated = true;
          }
        }
        break;
      // Add more rule type checks as needed
    }

    if (violated) {
      violations.push({
        policyId: policy.id,
        policyName: policy.name,
        ruleType: policy.rule_type,
        severity: policy.severity,
        violationMessage: policy.violation_message,
      });
    }
  }

  return violations;
}
