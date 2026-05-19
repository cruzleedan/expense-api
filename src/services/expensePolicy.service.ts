import { db } from '../db/drizzle.js';
import { expensePolicies } from '../db/schema.js';
import type { ExpensePolicy } from '../db/schema.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import { eq, and, or, ilike, asc, desc, count, ne, lte, gte, sql, type SQL } from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export type { ExpensePolicy };

export type RuleType = 'max_amount' | 'requires_receipt' | 'requires_approval' | 'time_limit' |
  'category_restriction' | 'merchant_restriction' | 'frequency_limit' | 'custom';

export type Severity = 'info' | 'warning' | 'hard_block';

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

export async function createExpensePolicy(
  input: CreateExpensePolicyInput,
  createdBy?: string
): Promise<ExpensePolicy> {
  if (input.code) {
    const [existing] = await db
      .select({ id: expensePolicies.id })
      .from(expensePolicies)
      .where(eq(expensePolicies.code, input.code))
      .limit(1);
    if (existing) {
      throw new ConflictError(`Policy with code "${input.code}" already exists`);
    }
  }

  const [result] = await db
    .insert(expensePolicies)
    .values({
      name: input.name,
      code: input.code ?? null,
      description: input.description,
      appliesToCategories: input.appliesToCategories ?? null,
      appliesToDepartments: input.appliesToDepartments ?? null,
      appliesToRoles: input.appliesToRoles ?? null,
      ruleType: input.ruleType,
      ruleConfig: input.ruleConfig,
      violationMessage: input.violationMessage,
      severity: input.severity ?? 'warning',
      isActive: input.isActive ?? true,
      effectiveDate: input.effectiveDate ?? null,
      expiryDate: input.expiryDate ?? null,
      createdBy: createdBy ?? null,
    })
    .returning();

  return result;
}

export async function getExpensePolicyById(policyId: string): Promise<ExpensePolicy> {
  const [result] = await db
    .select()
    .from(expensePolicies)
    .where(eq(expensePolicies.id, policyId))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Expense policy');
  }

  return result;
}

export async function listExpensePolicies(
  params: PaginationParams,
  filters?: ListPoliciesFilters
): Promise<{ policies: ExpensePolicy[]; total: number }> {
  const conditions: (SQL | undefined)[] = [
    filters?.isActive !== undefined ? eq(expensePolicies.isActive, filters.isActive) : undefined,
    filters?.ruleType ? eq(expensePolicies.ruleType, filters.ruleType) : undefined,
    filters?.severity ? eq(expensePolicies.severity, filters.severity) : undefined,
    params.search
      ? or(
          ilike(expensePolicies.name, `%${params.search}%`),
          ilike(expensePolicies.code, `%${params.search}%`),
          ilike(expensePolicies.description, `%${params.search}%`),
          ilike(expensePolicies.violationMessage, `%${params.search}%`)
        )
      : undefined,
  ];
  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const sortColMap = {
    name: expensePolicies.name,
    code: expensePolicies.code,
    ruleType: expensePolicies.ruleType,
    severity: expensePolicies.severity,
    effectiveDate: expensePolicies.effectiveDate,
    createdAt: expensePolicies.createdAt,
    updatedAt: expensePolicies.updatedAt,
  };
  const sortCol =
    params.sortBy && params.sortBy in sortColMap
      ? sortColMap[params.sortBy as keyof typeof sortColMap]
      : expensePolicies.name;
  const orderExpr = params.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expensePolicies)
      .where(where)
      .orderBy(orderExpr)
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expensePolicies).where(where),
  ]);

  return { policies: rows, total };
}

export async function updateExpensePolicy(
  policyId: string,
  input: UpdateExpensePolicyInput
): Promise<ExpensePolicy> {
  const existing = await getExpensePolicyById(policyId);

  if (input.code && input.code !== existing.code) {
    const [conflict] = await db
      .select({ id: expensePolicies.id })
      .from(expensePolicies)
      .where(and(eq(expensePolicies.code, input.code), ne(expensePolicies.id, policyId)))
      .limit(1);
    if (conflict) {
      throw new ConflictError(`Policy with code "${input.code}" already exists`);
    }
  }

  const updates: Partial<typeof expensePolicies.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.code !== undefined) updates.code = input.code;
  if (input.description !== undefined) updates.description = input.description;
  if (input.appliesToCategories !== undefined) updates.appliesToCategories = input.appliesToCategories;
  if (input.appliesToDepartments !== undefined) updates.appliesToDepartments = input.appliesToDepartments;
  if (input.appliesToRoles !== undefined) updates.appliesToRoles = input.appliesToRoles;
  if (input.ruleType !== undefined) updates.ruleType = input.ruleType;
  if (input.ruleConfig !== undefined) updates.ruleConfig = input.ruleConfig;
  if (input.violationMessage !== undefined) updates.violationMessage = input.violationMessage;
  if (input.severity !== undefined) updates.severity = input.severity;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.effectiveDate !== undefined) updates.effectiveDate = input.effectiveDate;
  if (input.expiryDate !== undefined) updates.expiryDate = input.expiryDate;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const [result] = await db
    .update(expensePolicies)
    .set({ ...updates, updatedAt: sql`NOW()` })
    .where(eq(expensePolicies.id, policyId))
    .returning();

  return result;
}

export async function deleteExpensePolicy(policyId: string): Promise<void> {
  await getExpensePolicyById(policyId);
  await db.delete(expensePolicies).where(eq(expensePolicies.id, policyId));
}

// ============================================================================
// Policy Validation
// ============================================================================

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
  const today = new Date().toISOString().slice(0, 10);
  const activePolicies = await db
    .select()
    .from(expensePolicies)
    .where(
      and(
        eq(expensePolicies.isActive, true),
        or(
          sql`${expensePolicies.effectiveDate} IS NULL`,
          lte(expensePolicies.effectiveDate, today)
        ),
        or(
          sql`${expensePolicies.expiryDate} IS NULL`,
          gte(expensePolicies.expiryDate, today)
        )
      )
    );

  const violations: PolicyViolation[] = [];

  for (const policy of activePolicies) {
    const categoryApplies =
      !policy.appliesToCategories ||
      (context.categoryId && policy.appliesToCategories.includes(context.categoryId));

    const departmentApplies =
      !policy.appliesToDepartments ||
      (context.departmentId && policy.appliesToDepartments.includes(context.departmentId));

    const roleApplies =
      !policy.appliesToRoles ||
      (context.userRoles && context.userRoles.some((r) => policy.appliesToRoles?.includes(r)));

    if (!categoryApplies || !departmentApplies || !roleApplies) continue;

    let violated = false;
    const config = policy.ruleConfig as Record<string, unknown>;

    switch (policy.ruleType) {
      case 'max_amount':
        if (context.amount != null && config.max_amount != null && context.amount > (config.max_amount as number)) {
          violated = true;
        }
        break;
      case 'requires_receipt':
        break;
      case 'time_limit':
        if (context.transactionDate && config.days_after_transaction != null) {
          const txDate = new Date(context.transactionDate);
          const now = new Date();
          const daysDiff = Math.floor((now.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > (config.days_after_transaction as number)) violated = true;
        }
        break;
      case 'merchant_restriction':
        if (context.merchantName && config.blocked_merchants) {
          const blocked = config.blocked_merchants as string[];
          if (blocked.some((m) => context.merchantName?.toLowerCase().includes(m.toLowerCase()))) {
            violated = true;
          }
        }
        break;
    }

    if (violated) {
      violations.push({
        policyId: policy.id,
        policyName: policy.name,
        ruleType: policy.ruleType as RuleType,
        severity: policy.severity as Severity,
        violationMessage: policy.violationMessage,
      });
    }
  }

  return violations;
}
