import { query } from '../db/client.js';
import { NotFoundError, ConflictError } from '../types/index.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  type PaginationParams,
} from '../utils/pagination.js';

export type OutputFormat = 'text' | 'json' | 'markdown' | 'chart_config';

export interface LlmPromptTemplate {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  user_prompt_template: string;
  required_context: string[] | null;
  output_format: OutputFormat;
  preferred_model: string | null;
  max_tokens: number;
  temperature: string; // DECIMAL comes as string
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateLlmPromptTemplateInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  userPromptTemplate: string;
  requiredContext?: string[];
  outputFormat?: OutputFormat;
  preferredModel?: string;
  maxTokens?: number;
  temperature?: number;
  isActive?: boolean;
}

export interface UpdateLlmPromptTemplateInput {
  name?: string;
  description?: string | null;
  systemPrompt?: string | null;
  userPromptTemplate?: string;
  requiredContext?: string[] | null;
  outputFormat?: OutputFormat;
  preferredModel?: string | null;
  maxTokens?: number;
  temperature?: number;
  isActive?: boolean;
}

export interface ListTemplatesFilters {
  isActive?: boolean;
  outputFormat?: OutputFormat;
}

const TEMPLATE_SORTABLE_FIELDS = ['name', 'output_format', 'version', 'created_at', 'updated_at'];
const TEMPLATE_SEARCHABLE_FIELDS = ['name', 'description', 'user_prompt_template'];

export async function createLlmPromptTemplate(
  input: CreateLlmPromptTemplateInput
): Promise<LlmPromptTemplate> {
  const existing = await query<LlmPromptTemplate>(
    'SELECT id FROM llm_prompt_templates WHERE name = $1',
    [input.name]
  );
  if (existing.rows.length > 0) {
    throw new ConflictError(`Template with name "${input.name}" already exists`);
  }

  const result = await query<LlmPromptTemplate>(
    `INSERT INTO llm_prompt_templates (
      name, description, system_prompt, user_prompt_template, required_context,
      output_format, preferred_model, max_tokens, temperature, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.name,
      input.description ?? null,
      input.systemPrompt ?? null,
      input.userPromptTemplate,
      input.requiredContext ?? null,
      input.outputFormat ?? 'text',
      input.preferredModel ?? null,
      input.maxTokens ?? 1000,
      input.temperature ?? 0.3,
      input.isActive ?? true
    ]
  );

  return result.rows[0];
}

export async function getLlmPromptTemplateById(templateId: string): Promise<LlmPromptTemplate> {
  const result = await query<LlmPromptTemplate>(
    'SELECT * FROM llm_prompt_templates WHERE id = $1',
    [templateId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('LLM prompt template');
  }

  return result.rows[0];
}

export async function getLlmPromptTemplateByName(name: string): Promise<LlmPromptTemplate> {
  const result = await query<LlmPromptTemplate>(
    'SELECT * FROM llm_prompt_templates WHERE name = $1 AND is_active = true',
    [name]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError(`LLM prompt template "${name}"`);
  }

  return result.rows[0];
}

export async function listLlmPromptTemplates(
  params: PaginationParams,
  filters?: ListTemplatesFilters
): Promise<{ templates: LlmPromptTemplate[]; total: number }> {
  const offset = getOffset(params);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.isActive !== undefined) {
    conditions.push(`is_active = $${paramIndex}`);
    values.push(filters.isActive);
    paramIndex++;
  }

  if (filters?.outputFormat) {
    conditions.push(`output_format = $${paramIndex}`);
    values.push(filters.outputFormat);
    paramIndex++;
  }

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    TEMPLATE_SEARCHABLE_FIELDS,
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
    TEMPLATE_SORTABLE_FIELDS,
    'name ASC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<LlmPromptTemplate>(
      `SELECT * FROM llm_prompt_templates ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM llm_prompt_templates ${whereClause}`,
      values
    ),
  ]);

  return {
    templates: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateLlmPromptTemplate(
  templateId: string,
  input: UpdateLlmPromptTemplateInput
): Promise<LlmPromptTemplate> {
  const existing = await getLlmPromptTemplateById(templateId);

  if (input.name && input.name !== existing.name) {
    const nameCheck = await query<LlmPromptTemplate>(
      'SELECT id FROM llm_prompt_templates WHERE name = $1 AND id != $2',
      [input.name, templateId]
    );
    if (nameCheck.rows.length > 0) {
      throw new ConflictError(`Template with name "${input.name}" already exists`);
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

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    values.push(input.description);
    paramIndex++;
  }

  if (input.systemPrompt !== undefined) {
    updates.push(`system_prompt = $${paramIndex}`);
    values.push(input.systemPrompt);
    paramIndex++;
  }

  if (input.userPromptTemplate !== undefined) {
    updates.push(`user_prompt_template = $${paramIndex}`);
    values.push(input.userPromptTemplate);
    paramIndex++;
  }

  if (input.requiredContext !== undefined) {
    updates.push(`required_context = $${paramIndex}`);
    values.push(input.requiredContext);
    paramIndex++;
  }

  if (input.outputFormat !== undefined) {
    updates.push(`output_format = $${paramIndex}`);
    values.push(input.outputFormat);
    paramIndex++;
  }

  if (input.preferredModel !== undefined) {
    updates.push(`preferred_model = $${paramIndex}`);
    values.push(input.preferredModel);
    paramIndex++;
  }

  if (input.maxTokens !== undefined) {
    updates.push(`max_tokens = $${paramIndex}`);
    values.push(input.maxTokens);
    paramIndex++;
  }

  if (input.temperature !== undefined) {
    updates.push(`temperature = $${paramIndex}`);
    values.push(input.temperature);
    paramIndex++;
  }

  if (input.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.isActive);
    paramIndex++;
  }

  if (updates.length === 0) {
    return existing;
  }

  // Increment version on update
  updates.push(`version = version + 1`);

  values.push(templateId);

  const result = await query<LlmPromptTemplate>(
    `UPDATE llm_prompt_templates SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteLlmPromptTemplate(templateId: string): Promise<void> {
  await getLlmPromptTemplateById(templateId);
  await query('DELETE FROM llm_prompt_templates WHERE id = $1', [templateId]);
}

// Render a template with context data
export interface TemplateRenderContext {
  [key: string]: unknown;
}

export function renderTemplate(
  template: LlmPromptTemplate,
  context: TemplateRenderContext
): { systemPrompt: string | null; userPrompt: string } {
  let userPrompt = template.user_prompt_template;

  // Replace {{placeholders}} with context values
  for (const [key, value] of Object.entries(context)) {
    const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    userPrompt = userPrompt.replace(placeholder, String(value));
  }

  return {
    systemPrompt: template.system_prompt,
    userPrompt,
  };
}

// Get template and render with context
export async function getAndRenderTemplate(
  templateName: string,
  context: TemplateRenderContext
): Promise<{
  template: LlmPromptTemplate;
  rendered: { systemPrompt: string | null; userPrompt: string };
}> {
  const template = await getLlmPromptTemplateByName(templateName);
  const rendered = renderTemplate(template, context);

  return { template, rendered };
}
