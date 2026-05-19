import { db } from '../db/drizzle.js';
import { expenseCategories } from '../db/schema.js';
import type { ExpenseCategory } from '../db/schema.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import { eq, and, or, ilike, asc, desc, count, ne, type SQL } from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export type { ExpenseCategory };

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

  const [result] = await db
    .update(expenseCategories)
    .set(updates)
    .where(eq(expenseCategories.id, categoryId))
    .returning();

  return result;
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

  await db.delete(expenseCategories).where(eq(expenseCategories.id, categoryId));
}
