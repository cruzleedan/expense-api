import { query } from '../db/client.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  type PaginationParams,
} from '../utils/pagination.js';

export interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  client_name: string | null;
  client_code: string | null;
  client_industry: string | null;
  client_contact_email: string | null;
  department_id: string | null;
  owner_user_id: string | null;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
  budget_amount: string | null;
  budget_currency: string;
  spent_amount: string;
  remaining_amount: string | null;
  utilization_pct: string | null;
  start_date: Date | null;
  end_date: Date | null;
  tags: string[] | null;
  full_path: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectInput {
  name: string;
  code?: string;
  description?: string;
  clientName?: string;
  clientCode?: string;
  clientIndustry?: string;
  clientContactEmail?: string;
  departmentId?: string;
  ownerUserId?: string;
  status?: 'active' | 'on_hold' | 'completed' | 'cancelled';
  budgetAmount?: number;
  budgetCurrency?: string;
  startDate?: string;
  endDate?: string;
  tags?: string[];
}

export interface UpdateProjectInput {
  name?: string;
  code?: string;
  description?: string;
  clientName?: string | null;
  clientCode?: string | null;
  clientIndustry?: string | null;
  clientContactEmail?: string | null;
  departmentId?: string | null;
  ownerUserId?: string | null;
  status?: 'active' | 'on_hold' | 'completed' | 'cancelled';
  budgetAmount?: number | null;
  budgetCurrency?: string;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[] | null;
}

export interface ListProjectsFilters {
  status?: 'active' | 'on_hold' | 'completed' | 'cancelled';
  departmentId?: string;
  ownerUserId?: string;
  clientName?: string;
}

const PROJECT_SORTABLE_FIELDS = ['name', 'code', 'status', 'budget_amount', 'spent_amount', 'start_date', 'end_date', 'created_at', 'updated_at'];
const PROJECT_SEARCHABLE_FIELDS = ['name', 'code', 'description', 'client_name', 'client_code'];

export async function createProject(input: CreateProjectInput): Promise<Project> {
  if (input.code) {
    const existing = await query<Project>(
      'SELECT id FROM projects WHERE code = $1',
      [input.code]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError(`Project with code "${input.code}" already exists`);
    }
  }

  // Generate full_path from client_name and project name
  const fullPath = input.clientName
    ? `${input.clientName} > ${input.name}`
    : input.name;

  const result = await query<Project>(
    `INSERT INTO projects (
      name, code, description, client_name, client_code, client_industry, client_contact_email,
      department_id, owner_user_id, status, budget_amount, budget_currency,
      start_date, end_date, tags, full_path
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      input.name,
      input.code ?? null,
      input.description ?? null,
      input.clientName ?? null,
      input.clientCode ?? null,
      input.clientIndustry ?? null,
      input.clientContactEmail ?? null,
      input.departmentId ?? null,
      input.ownerUserId ?? null,
      input.status ?? 'active',
      input.budgetAmount ?? null,
      input.budgetCurrency ?? 'USD',
      input.startDate ?? null,
      input.endDate ?? null,
      input.tags ?? null,
      fullPath
    ]
  );

  return result.rows[0];
}

export async function getProjectById(projectId: string): Promise<Project> {
  const result = await query<Project>(
    'SELECT * FROM projects WHERE id = $1',
    [projectId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Project');
  }

  return result.rows[0];
}

export async function listProjects(
  params: PaginationParams,
  filters?: ListProjectsFilters
): Promise<{ projects: Project[]; total: number }> {
  const offset = getOffset(params);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.status) {
    conditions.push(`status = $${paramIndex}`);
    values.push(filters.status);
    paramIndex++;
  }

  if (filters?.departmentId) {
    conditions.push(`department_id = $${paramIndex}`);
    values.push(filters.departmentId);
    paramIndex++;
  }

  if (filters?.ownerUserId) {
    conditions.push(`owner_user_id = $${paramIndex}`);
    values.push(filters.ownerUserId);
    paramIndex++;
  }

  if (filters?.clientName) {
    conditions.push(`client_name ILIKE $${paramIndex}`);
    values.push(`%${filters.clientName}%`);
    paramIndex++;
  }

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    PROJECT_SEARCHABLE_FIELDS,
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
    PROJECT_SORTABLE_FIELDS,
    'name ASC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<Project>(
      `SELECT * FROM projects ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM projects ${whereClause}`,
      values
    ),
  ]);

  return {
    projects: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput
): Promise<Project> {
  const existing = await getProjectById(projectId);

  if (input.code && input.code !== existing.code) {
    const codeCheck = await query<Project>(
      'SELECT id FROM projects WHERE code = $1 AND id != $2',
      [input.code, projectId]
    );
    if (codeCheck.rows.length > 0) {
      throw new ConflictError(`Project with code "${input.code}" already exists`);
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const fieldMappings: Record<string, string> = {
    name: 'name',
    code: 'code',
    description: 'description',
    clientName: 'client_name',
    clientCode: 'client_code',
    clientIndustry: 'client_industry',
    clientContactEmail: 'client_contact_email',
    departmentId: 'department_id',
    ownerUserId: 'owner_user_id',
    status: 'status',
    budgetAmount: 'budget_amount',
    budgetCurrency: 'budget_currency',
    startDate: 'start_date',
    endDate: 'end_date',
    tags: 'tags',
  };

  for (const [inputKey, dbColumn] of Object.entries(fieldMappings)) {
    const value = input[inputKey as keyof UpdateProjectInput];
    if (value !== undefined) {
      updates.push(`${dbColumn} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  // Update full_path if name or clientName changed
  const newName = input.name ?? existing.name;
  const newClientName = input.clientName !== undefined ? input.clientName : existing.client_name;
  const newFullPath = newClientName ? `${newClientName} > ${newName}` : newName;

  if (input.name !== undefined || input.clientName !== undefined) {
    updates.push(`full_path = $${paramIndex}`);
    values.push(newFullPath);
    paramIndex++;
  }

  if (updates.length === 0) {
    return existing;
  }

  values.push(projectId);

  const result = await query<Project>(
    `UPDATE projects SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteProject(projectId: string): Promise<void> {
  await getProjectById(projectId);

  // Check if project has any expense reports
  const reports = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM expense_reports WHERE project_id = $1',
    [projectId]
  );

  if (parseInt(reports.rows[0].count, 10) > 0) {
    throw new ConflictError('Cannot delete project with existing expense reports');
  }

  // Check if project has any expense lines
  const lines = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM expense_lines WHERE project_id = $1',
    [projectId]
  );

  if (parseInt(lines.rows[0].count, 10) > 0) {
    throw new ConflictError('Cannot delete project with existing expense lines');
  }

  await query('DELETE FROM projects WHERE id = $1', [projectId]);
}

// Update spent_amount for a project (called when expenses are added/removed)
export async function updateProjectSpentAmount(projectId: string): Promise<Project> {
  const result = await query<Project>(
    `UPDATE projects
     SET spent_amount = COALESCE((
       SELECT SUM(el.amount)
       FROM expense_lines el
       JOIN expense_reports er ON el.report_id = er.id
       WHERE el.project_id = $1 AND er.status IN ('approved', 'posted')
     ), 0),
     updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [projectId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Project');
  }

  return result.rows[0];
}

// Get project budget summary
export async function getProjectBudgetSummary(projectId: string): Promise<{
  project: Project;
  expenseCount: number;
  reportCount: number;
  categoryBreakdown: Record<string, number>;
}> {
  const project = await getProjectById(projectId);

  const [expenseCount, reportCount, categoryBreakdown] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM expense_lines WHERE project_id = $1`,
      [projectId]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM expense_reports WHERE project_id = $1`,
      [projectId]
    ),
    query<{ category: string; total: string }>(
      `SELECT COALESCE(ec.name, 'Uncategorized') as category, SUM(el.amount) as total
       FROM expense_lines el
       LEFT JOIN expense_categories ec ON el.category_code = ec.code
       WHERE el.project_id = $1
       GROUP BY ec.name
       ORDER BY total DESC`,
      [projectId]
    ),
  ]);

  const breakdown: Record<string, number> = {};
  for (const row of categoryBreakdown.rows) {
    breakdown[row.category] = parseFloat(row.total);
  }

  return {
    project,
    expenseCount: parseInt(expenseCount.rows[0].count, 10),
    reportCount: parseInt(reportCount.rows[0].count, 10),
    categoryBreakdown: breakdown,
  };
}
