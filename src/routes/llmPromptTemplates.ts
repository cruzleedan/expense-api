import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  createLlmPromptTemplate,
  getLlmPromptTemplateById,
  getLlmPromptTemplateByName,
  listLlmPromptTemplates,
  updateLlmPromptTemplate,
  deleteLlmPromptTemplate,
  renderTemplate,
} from '../services/llmPromptTemplate.service.js';
import { paginate } from '../utils/pagination.js';
import {
  LlmPromptTemplateSchema,
  CreateLlmPromptTemplateSchema,
  UpdateLlmPromptTemplateSchema,
  LlmPromptTemplateListQuerySchema,
  LlmPromptTemplateListResponseSchema,
  RenderTemplateRequestSchema,
  RenderedTemplateSchema,
} from '../schemas/llmPromptTemplate.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';
import { z } from '@hono/zod-openapi';

const llmPromptTemplatesRouter = new OpenAPIHono();

// All routes require authentication
llmPromptTemplatesRouter.use('*', authMiddleware);

// Security definition for all routes
const security = [{ Bearer: [] }];

// List LLM prompt templates
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['LLM Prompt Templates'],
  summary: 'List LLM prompt templates',
  description: 'Get paginated list of LLM prompt templates with optional filters',
  security,
  request: {
    query: LlmPromptTemplateListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of templates',
      content: { 'application/json': { schema: LlmPromptTemplateListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const filters = {
    isActive: query.isActive,
    outputFormat: query.outputFormat,
  };

  const { templates, total } = await listLlmPromptTemplates(paginationParams, filters);

  return c.json(paginate(templates, total, paginationParams), 200);
});

// Create LLM prompt template
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['LLM Prompt Templates'],
  summary: 'Create LLM prompt template',
  description: 'Create a new LLM prompt template',
  security,
  middleware: [requirePermission('llm.template.create')] as const,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateLlmPromptTemplateSchema } },
    },
  },
  responses: {
    201: {
      description: 'Template created',
      content: { 'application/json': { schema: LlmPromptTemplateSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Conflict - name already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(createRoute_, async (c) => {
  const input = c.req.valid('json');

  const template = await createLlmPromptTemplate(input);

  return c.json(template, 201);
});

// Get LLM prompt template by ID
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['LLM Prompt Templates'],
  summary: 'Get LLM prompt template',
  description: 'Get a specific LLM prompt template by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Template details',
      content: { 'application/json': { schema: LlmPromptTemplateSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');

  const template = await getLlmPromptTemplateById(id);

  return c.json(template, 200);
});

// Get template by name
const NameParamSchema = z.object({
  name: z.string().min(1).max(100),
}).openapi('NameParam');

const getByNameRoute = createRoute({
  method: 'get',
  path: '/by-name/{name}',
  tags: ['LLM Prompt Templates'],
  summary: 'Get LLM prompt template by name',
  description: 'Get a specific active LLM prompt template by name',
  security,
  request: {
    params: NameParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Template details',
      content: { 'application/json': { schema: LlmPromptTemplateSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(getByNameRoute, async (c) => {
  const { name } = c.req.valid('param');

  const template = await getLlmPromptTemplateByName(name);

  return c.json(template, 200);
});

// Render template with context
const renderRoute = createRoute({
  method: 'post',
  path: '/{id}/render',
  tags: ['LLM Prompt Templates'],
  summary: 'Render LLM prompt template',
  description: 'Render a template by replacing placeholders with provided context values',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: RenderTemplateRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Rendered template',
      content: { 'application/json': { schema: RenderedTemplateSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(renderRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { context } = c.req.valid('json');

  const template = await getLlmPromptTemplateById(id);
  const rendered = renderTemplate(template, context);

  return c.json({ template, rendered }, 200);
});

// Update LLM prompt template
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['LLM Prompt Templates'],
  summary: 'Update LLM prompt template',
  description: 'Update an existing LLM prompt template (increments version)',
  security,
  middleware: [requirePermission('llm.template.edit')] as const,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateLlmPromptTemplateSchema } },
    },
  },
  responses: {
    200: {
      description: 'Template updated',
      content: { 'application/json': { schema: LlmPromptTemplateSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Conflict - name already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const template = await updateLlmPromptTemplate(id, input);

  return c.json(template, 200);
});

// Delete LLM prompt template
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['LLM Prompt Templates'],
  summary: 'Delete LLM prompt template',
  description: 'Delete an LLM prompt template',
  security,
  middleware: [requirePermission('llm.template.delete')] as const,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Template deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

llmPromptTemplatesRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');

  await deleteLlmPromptTemplate(id);

  return c.json({ message: 'Template deleted' }, 200);
});

export { llmPromptTemplatesRouter };
