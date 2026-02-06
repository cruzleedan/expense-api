import { query } from '../db/client.js';
import type { ExpenseCategory } from '../types/index.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  EXPENSE_CATEGORY_SORTABLE_FIELDS,
  EXPENSE_CATEGORY_SEARCHABLE_FIELDS,
  type PaginationParams,
} from '../utils/pagination.js';

export interface CreateExpenseCategoryInput {
  name: string;
  code?: string;
  description?: string;
  parentId?: string;
  // v5.0 LLM fields
  keywords?: string[];
  synonyms?: string[];
  typicalAmountRange?: Record<string, unknown>;
}

export interface UpdateExpenseCategoryInput {
  name?: string;
  code?: string;
  description?: string;
  isActive?: boolean;
  parentId?: string | null;
  // v5.0 LLM fields
  keywords?: string[];
  synonyms?: string[];
  typicalAmountRange?: Record<string, unknown> | null;
}

export async function createExpenseCategory(
  input: CreateExpenseCategoryInput
): Promise<ExpenseCategory> {
  if (input.code) {
    const existing = await query<ExpenseCategory>(
      'SELECT id FROM expense_categories WHERE code = $1',
      [input.code]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError(`Category with code "${input.code}" already exists`);
    }
  }

  const result = await query<ExpenseCategory>(
    `INSERT INTO expense_categories (name, code, description, parent_id, keywords, synonyms, typical_amount_range)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.name,
      input.code ?? null,
      input.description ?? null,
      input.parentId ?? null,
      input.keywords ?? null,
      input.synonyms ?? null,
      input.typicalAmountRange ? JSON.stringify(input.typicalAmountRange) : null
    ]
  );

  return result.rows[0];
}

export async function getExpenseCategoryById(
  categoryId: string
): Promise<ExpenseCategory> {
  const result = await query<ExpenseCategory>(
    'SELECT * FROM expense_categories WHERE id = $1',
    [categoryId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Expense category');
  }

  return result.rows[0];
}

export async function listExpenseCategories(
  params: PaginationParams,
  isActive?: boolean
): Promise<{ categories: ExpenseCategory[]; total: number }> {
  const offset = getOffset(params);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (isActive !== undefined) {
    conditions.push(`is_active = $${paramIndex}`);
    values.push(isActive);
    paramIndex++;
  }

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    EXPENSE_CATEGORY_SEARCHABLE_FIELDS,
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY clause with allowed fields, default to name ASC
  const orderBy = buildOrderByClause(
    params,
    EXPENSE_CATEGORY_SORTABLE_FIELDS,
    'name ASC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<ExpenseCategory>(
      `SELECT * FROM expense_categories ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM expense_categories ${whereClause}`,
      values
    ),
  ]);

  return {
    categories: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateExpenseCategory(
  categoryId: string,
  input: UpdateExpenseCategoryInput
): Promise<ExpenseCategory> {
  await getExpenseCategoryById(categoryId);

  if (input.code) {
    const existing = await query<ExpenseCategory>(
      'SELECT id FROM expense_categories WHERE code = $1 AND id != $2',
      [input.code, categoryId]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError(`Category with code "${input.code}" already exists`);
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

  if (input.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.isActive);
    paramIndex++;
  }

  if (input.parentId !== undefined) {
    updates.push(`parent_id = $${paramIndex}`);
    values.push(input.parentId);
    paramIndex++;
  }

  if (input.keywords !== undefined) {
    updates.push(`keywords = $${paramIndex}`);
    values.push(input.keywords);
    paramIndex++;
  }

  if (input.synonyms !== undefined) {
    updates.push(`synonyms = $${paramIndex}`);
    values.push(input.synonyms);
    paramIndex++;
  }

  if (input.typicalAmountRange !== undefined) {
    updates.push(`typical_amount_range = $${paramIndex}`);
    values.push(input.typicalAmountRange ? JSON.stringify(input.typicalAmountRange) : null);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getExpenseCategoryById(categoryId);
  }

  values.push(categoryId);

  const result = await query<ExpenseCategory>(
    `UPDATE expense_categories SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteExpenseCategory(categoryId: string): Promise<void> {
  await getExpenseCategoryById(categoryId);

  const childCount = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM expense_categories WHERE parent_id = $1',
    [categoryId]
  );

  if (parseInt(childCount.rows[0].count, 10) > 0) {
    throw new ConflictError('Cannot delete category with child categories');
  }

  await query('DELETE FROM expense_categories WHERE id = $1', [categoryId]);
}
