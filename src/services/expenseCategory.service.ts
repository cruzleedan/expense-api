import { db } from '../db/drizzle.js';
import { expenseCategories, expenseLines } from '../db/schema.js';
import type { ExpenseCategory } from '../db/schema.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import { eq, and, or, ilike, asc, desc, count, ne, sql, type SQL } from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export type { ExpenseCategory };

// WORK-0020: the pre-check SELECTs below narrow the common case to a clean
// 409 before hitting the DB, but two concurrent requests can both pass the
// SELECT before either commits — the unique indexes on `code` and
// `lower(trim(name))` are what actually stop the second write. This catches
// that race and converts it to the same ConflictError, instead of letting
// the raw Postgres unique-violation fall through to a generic 500.
interface PossiblePgError extends Error {
  code?: string;
  constraint?: string;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = error as PossiblePgError;
  return (
    error instanceof Error &&
    pgError.code === '23505' &&
    pgError.constraint === constraint
  );
}

export interface CreateExpenseCategoryInput {
  name: string;
  code?: string;
  description?: string;
  parentId?: string;
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
  keywords?: string[] | null;
  synonyms?: string[] | null;
  typicalAmountRange?: Record<string, unknown> | null;
}

export async function createExpenseCategory(
  input: CreateExpenseCategoryInput
): Promise<ExpenseCategory> {
  if (input.code) {
    const [existing] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(eq(expenseCategories.code, input.code))
      .limit(1);
    if (existing) {
      throw new ConflictError(`Category with code "${input.code}" already exists`);
    }
  }

  const [existingName] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(sql`lower(trim(${expenseCategories.name})) = lower(trim(${input.name}))`)
    .limit(1);
  if (existingName) {
    throw new ConflictError(`Category with name "${input.name}" already exists`);
  }

  try {
    const [result] = await db
      .insert(expenseCategories)
      .values({
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        keywords: input.keywords ?? null,
        synonyms: input.synonyms ?? null,
        typicalAmountRange: input.typicalAmountRange ?? null,
      })
      .returning();

    return result;
  } catch (error) {
    if (isUniqueViolation(error, 'expense_categories_code_key')) {
      throw new ConflictError(`Category with code "${input.code}" already exists`);
    }
    if (isUniqueViolation(error, 'expense_categories_name_unique_ci')) {
      throw new ConflictError(`Category with name "${input.name}" already exists`);
    }
    throw error;
  }
}

export async function getExpenseCategoryById(
  categoryId: string
): Promise<ExpenseCategory> {
  const [result] = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, categoryId))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Expense category');
  }

  return result;
}

export async function listExpenseCategories(
  params: PaginationParams,
  isActive?: boolean
): Promise<{ categories: ExpenseCategory[]; total: number }> {
  const conditions: (SQL | undefined)[] = [
    isActive !== undefined ? eq(expenseCategories.isActive, isActive) : undefined,
    params.search
      ? or(
          ilike(expenseCategories.name, `%${params.search}%`),
          ilike(expenseCategories.code, `%${params.search}%`),
          ilike(expenseCategories.description, `%${params.search}%`)
        )
      : undefined,
  ];
  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const sortColMap = {
    name: expenseCategories.name,
    code: expenseCategories.code,
    createdAt: expenseCategories.createdAt,
    updatedAt: expenseCategories.updatedAt,
  };
  const sortCol =
    params.sortBy && params.sortBy in sortColMap
      ? sortColMap[params.sortBy as keyof typeof sortColMap]
      : expenseCategories.name;
  const orderExpr = params.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseCategories)
      .where(where)
      .orderBy(orderExpr)
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expenseCategories).where(where),
  ]);

  return { categories: rows, total };
}

export async function updateExpenseCategory(
  categoryId: string,
  input: UpdateExpenseCategoryInput
): Promise<ExpenseCategory> {
  await getExpenseCategoryById(categoryId);

  if (input.code) {
    const [conflict] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(and(eq(expenseCategories.code, input.code), ne(expenseCategories.id, categoryId)))
      .limit(1);
    if (conflict) {
      throw new ConflictError(`Category with code "${input.code}" already exists`);
    }
  }

  if (input.name !== undefined) {
    const [conflict] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        and(
          sql`lower(trim(${expenseCategories.name})) = lower(trim(${input.name}))`,
          ne(expenseCategories.id, categoryId)
        )
      )
      .limit(1);
    if (conflict) {
      throw new ConflictError(`Category with name "${input.name}" already exists`);
    }
  }

  const updates: Partial<typeof expenseCategories.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.code !== undefined) updates.code = input.code;
  if (input.description !== undefined) updates.description = input.description;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.parentId !== undefined) updates.parentId = input.parentId;
  if (input.keywords !== undefined) updates.keywords = input.keywords;
  if (input.synonyms !== undefined) updates.synonyms = input.synonyms;
  if (input.typicalAmountRange !== undefined) updates.typicalAmountRange = input.typicalAmountRange;

  if (Object.keys(updates).length === 0) {
    return getExpenseCategoryById(categoryId);
  }

  try {
    const [result] = await db
      .update(expenseCategories)
      .set(updates)
      .where(eq(expenseCategories.id, categoryId))
      .returning();

    return result;
  } catch (error) {
    if (isUniqueViolation(error, 'expense_categories_code_key')) {
      throw new ConflictError(`Category with code "${input.code}" already exists`);
    }
    if (isUniqueViolation(error, 'expense_categories_name_unique_ci')) {
      throw new ConflictError(`Category with name "${input.name}" already exists`);
    }
    throw error;
  }
}

export async function deleteExpenseCategory(categoryId: string): Promise<void> {
  await getExpenseCategoryById(categoryId);

  const [{ childCount }] = await db
    .select({ childCount: count() })
    .from(expenseCategories)
    .where(eq(expenseCategories.parentId, categoryId));

  if (childCount > 0) {
    throw new ConflictError('Cannot delete category with child categories');
  }

  // WORK-0020: expense_lines.categoryId has an FK back to this table with
  // no ON DELETE clause (default RESTRICT), but that only produced a raw,
  // unhandled Postgres error (500) — this check turns it into a clean 409
  // before the delete is attempted. Deliberately NOT filtering out
  // soft-deleted lines here: a soft delete only sets deletedAt, it doesn't
  // null out categoryId, so the FK reference (and the RESTRICT it enforces)
  // is still physically live regardless of deletedAt. Filtering by
  // isNull(deletedAt) was tried and verified live to let a soft-deleted
  // line's category through this check only for the actual DELETE to still
  // hit the same raw 500 — this count has to match what the FK constraint
  // actually sees, not what the UI considers "in use."
  const [{ lineCount }] = await db
    .select({ lineCount: count() })
    .from(expenseLines)
    .where(eq(expenseLines.categoryId, categoryId));

  if (lineCount > 0) {
    throw new ConflictError(
      `Cannot delete category — in use by ${lineCount} expense line${lineCount === 1 ? '' : 's'}`
    );
  }

  await db.delete(expenseCategories).where(eq(expenseCategories.id, categoryId));
}
