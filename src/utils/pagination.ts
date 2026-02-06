import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/**
 * Sortable field configuration maps API field aliases to actual database column names.
 * This provides security by:
 * 1. Only allowing sorting on explicitly defined fields
 * 2. Hiding actual database column names from API consumers
 * 3. Allowing different API names than DB column names
 */
export type SortableFieldsConfig = Record<string, string>;

// Sortable fields configuration for each resource
// Keys are API-facing aliases, values are actual database column names
export const EXPENSE_REPORT_SORTABLE_FIELDS: SortableFieldsConfig = {
  title: 'title',
  status: 'status',
  totalAmount: 'total_amount',
  reportDate: 'report_date',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  submittedAt: 'submitted_at',
};

export const USER_SORTABLE_FIELDS: SortableFieldsConfig = {
  email: 'email',
  username: 'username',
  firstName: 'first_name',
  lastName: 'last_name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  lastLoginAt: 'last_login_at',
};

export const EXPENSE_CATEGORY_SORTABLE_FIELDS: SortableFieldsConfig = {
  name: 'name',
  code: 'code',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export const ROLE_SORTABLE_FIELDS: SortableFieldsConfig = {
  name: 'name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  permissionCount: 'permission_count',
};

export const EXPENSE_LINE_SORTABLE_FIELDS: SortableFieldsConfig = {
  description: 'description',
  amount: 'amount',
  transactionDate: 'transaction_date',
  category: 'category',
  createdAt: 'created_at',
};

export const RECEIPT_SORTABLE_FIELDS: SortableFieldsConfig = {
  fileName: 'file_name',
  fileSize: 'file_size',
  createdAt: 'created_at',
};

export const PERMISSION_SORTABLE_FIELDS: SortableFieldsConfig = {
  name: 'name',
  category: 'category',
  riskLevel: 'risk_level',
  createdAt: 'created_at',
};

// Searchable fields configuration for each resource
// These are the database columns that will be searched with ILIKE
export const EXPENSE_REPORT_SEARCHABLE_FIELDS = ['title', 'description'];
export const USER_SEARCHABLE_FIELDS = ['email', 'username', 'first_name', 'last_name'];
export const EXPENSE_CATEGORY_SEARCHABLE_FIELDS = ['name', 'code', 'description'];
export const ROLE_SEARCHABLE_FIELDS = ['name', 'description'];
export const EXPENSE_LINE_SEARCHABLE_FIELDS = ['description', 'category'];
export const RECEIPT_SEARCHABLE_FIELDS = ['file_name'];
export const PERMISSION_SEARCHABLE_FIELDS = ['name', 'description'];

/**
 * Validates and resolves a sort field alias to its database column name.
 * Returns undefined if the field is not allowed.
 */
export function resolveSortField(
  sortBy: string | undefined,
  allowedFields: SortableFieldsConfig
): string | undefined {
  if (!sortBy) return undefined;
  return allowedFields[sortBy];
}

/**
 * Builds an ORDER BY clause from pagination params.
 * Returns the default order if sortBy is not provided or invalid.
 */
export function buildOrderByClause(
  params: PaginationParams,
  allowedFields: SortableFieldsConfig,
  defaultOrder: string
): string {
  const dbColumn = resolveSortField(params.sortBy, allowedFields);
  if (!dbColumn) {
    return defaultOrder;
  }
  const direction = params.sortOrder === 'desc' ? 'DESC' : 'ASC';
  return `${dbColumn} ${direction}`;
}

/**
 * Builds a search condition for WHERE clause using ILIKE.
 * Returns null if no search term is provided.
 * @param searchTerm The search term from user input
 * @param searchableFields Array of database column names to search
 * @param paramIndex The starting parameter index for the query
 * @returns Object with condition string and the search value, or null if no search
 */
export function buildSearchCondition(
  searchTerm: string | undefined,
  searchableFields: string[],
  paramIndex: number
): { condition: string; value: string; nextParamIndex: number } | null {
  if (!searchTerm || searchTerm.trim() === '' || searchableFields.length === 0) {
    return null;
  }

  // Escape special characters for LIKE pattern
  const escapedSearch = searchTerm.replace(/[%_\\]/g, '\\$&');
  const searchPattern = `%${escapedSearch}%`;

  const conditions = searchableFields.map((field) => `${field} ILIKE $${paramIndex}`);
  const condition = `(${conditions.join(' OR ')})`;

  return {
    condition,
    value: searchPattern,
    nextParamIndex: paramIndex + 1,
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function paginate<T>(
  data: T[],
  total: number,
  params: PaginationParams
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / params.limit);

  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNext: params.page < totalPages,
      hasPrev: params.page > 1,
    },
  };
}

export function getOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}
