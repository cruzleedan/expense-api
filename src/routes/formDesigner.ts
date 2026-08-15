import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { RouteHandler } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  listForms,
  createForm,
  getFormDetail,
  deleteForm,
  publishForm,
  createField,
  updateField,
  deleteField,
  replaceFieldRoleRules,
  replaceFieldPlatformRules,
  replaceFieldValidationRules,
  replaceFieldOptions,
} from '../services/formDesigner.service.js';
import {
  FormDefinitionSchema,
  FormDefinitionDetailSchema,
  FormListQuerySchema,
  FormListResponseSchema,
  CreateFormRequestSchema,
  FormIdParamSchema,
  FieldIdParamSchema,
  FieldDefinitionSchema,
  FieldRoleRuleSchema,
  FieldPlatformRuleSchema,
  FieldValidationRuleSchema,
  FieldOptionSchema,
  CreateFieldRequestSchema,
  UpdateFieldRequestSchema,
  ReplaceRoleRulesRequestSchema,
  ReplacePlatformRulesRequestSchema,
  ReplaceValidationRulesRequestSchema,
  ReplaceOptionsRequestSchema,
} from '../schemas/formDesigner.js';
import { ErrorSchema, MessageSchema, AuthHeaderSchema } from '../schemas/common.js';
import { z } from '@hono/zod-openapi';

const formDesignerRouter = new OpenAPIHono();

formDesignerRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// GET /v1/admin/forms — list forms
// ============================================================================

const listFormsRoute = createRoute({
  method: 'get',
  path: '/forms',
  tags: ['Form Designer'],
  summary: 'List forms',
  description: 'List all form_definitions with pagination',
  security,
  middleware: [requirePermission('form.view')] as const,
  request: { query: FormListQuerySchema, headers: AuthHeaderSchema },
  responses: {
    200: { description: 'List of forms', content: { 'application/json': { schema: FormListResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const listFormsHandler: RouteHandler<typeof listFormsRoute> = async (c) => {
  const q = c.req.valid('query');
  const params = { page: q.page, limit: q.limit, sortBy: q.sortBy, sortOrder: q.sortOrder };
  const { forms, total } = await listForms(params, { status: q.status });
  const totalPages = Math.ceil(total / q.limit);
  return c.json({
    data: forms,
    pagination: {
      page: q.page, limit: q.limit, total, totalPages,
      hasNext: q.page < totalPages, hasPrev: q.page > 1,
    },
  } as any, 200);
};
formDesignerRouter.openapi(listFormsRoute, listFormsHandler);

// ============================================================================
// POST /v1/admin/forms — create a new form (new screen)
// ============================================================================

const createFormRoute = createRoute({
  method: 'post',
  path: '/forms',
  tags: ['Form Designer'],
  summary: 'Create a form',
  description: 'Create a new form_definitions row for a screenId. Not in the original handoff doc\'s endpoint list — added because there was otherwise no way to add a form for a new screen without a manual SQL insert.',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: { headers: AuthHeaderSchema, body: { content: { 'application/json': { schema: CreateFormRequestSchema } } } },
  responses: {
    201: { description: 'Form created', content: { 'application/json': { schema: FormDefinitionSchema } } },
    409: { description: 'screenId already exists', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const createFormHandler: RouteHandler<typeof createFormRoute> = async (c) => {
  const input = c.req.valid('json');
  const form = await createForm(input);
  return c.json(form as any, 201);
};
formDesignerRouter.openapi(createFormRoute, createFormHandler);

// ============================================================================
// GET /v1/admin/forms/{formId} — form + fields + rules + options
// ============================================================================

const getFormRoute = createRoute({
  method: 'get',
  path: '/forms/{formId}',
  tags: ['Form Designer'],
  summary: 'Get form detail',
  description: 'Get one form with all its fields, role rules, validation rules, and options — everything the designer page needs in one call',
  security,
  middleware: [requirePermission('form.view')] as const,
  request: { params: FormIdParamSchema, headers: AuthHeaderSchema },
  responses: {
    200: { description: 'Form detail', content: { 'application/json': { schema: FormDefinitionDetailSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const getFormHandler: RouteHandler<typeof getFormRoute> = async (c) => {
  const { formId } = c.req.valid('param');
  const form = await getFormDetail(formId);
  return c.json(form as any, 200);
};
formDesignerRouter.openapi(getFormRoute, getFormHandler);

// ============================================================================
// DELETE /v1/admin/forms/{formId} — delete a non-locked form
// ============================================================================

const deleteFormRoute = createRoute({
  method: 'delete',
  path: '/forms/{formId}',
  tags: ['Form Designer'],
  summary: 'Delete a form',
  description: 'Delete a user-created form and everything on it (fields, rules, options, custom field values). Locked system forms cannot be deleted.',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: { params: FormIdParamSchema, headers: AuthHeaderSchema },
  responses: {
    200: { description: 'Form deleted', content: { 'application/json': { schema: MessageSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Cannot delete a locked system form', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const deleteFormHandler: RouteHandler<typeof deleteFormRoute> = async (c) => {
  const { formId } = c.req.valid('param');
  await deleteForm(formId);
  return c.json({ message: 'Form deleted successfully' }, 200);
};
formDesignerRouter.openapi(deleteFormRoute, deleteFormHandler);

// ============================================================================
// POST /v1/admin/forms/{formId}/fields — create a user-defined field
// ============================================================================

const createFieldRoute = createRoute({
  method: 'post',
  path: '/forms/{formId}/fields',
  tags: ['Form Designer'],
  summary: 'Create a field',
  description: 'Create a new user-defined field on a form',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: {
    params: FormIdParamSchema,
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: CreateFieldRequestSchema } } },
  },
  responses: {
    201: { description: 'Field created', content: { 'application/json': { schema: FieldDefinitionSchema } } },
    404: { description: 'Form not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Field key already exists on this form', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const createFieldHandler: RouteHandler<typeof createFieldRoute> = async (c) => {
  const { formId } = c.req.valid('param');
  const input = c.req.valid('json');
  const field = await createField(formId, input);
  return c.json(field as any, 201);
};
formDesignerRouter.openapi(createFieldRoute, createFieldHandler);

// ============================================================================
// POST /v1/admin/forms/{formId}/publish — draft → published, bumps version
// ============================================================================

const publishFormRoute = createRoute({
  method: 'post',
  path: '/forms/{formId}/publish',
  tags: ['Form Designer'],
  summary: 'Publish a form',
  description: 'Publish a form, making its current field configuration live for the expense app and bumping its version',
  security,
  middleware: [requirePermission('form.publish')] as const,
  request: { params: FormIdParamSchema, headers: AuthHeaderSchema },
  responses: {
    200: { description: 'Form published', content: { 'application/json': { schema: FormDefinitionSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const publishFormHandler: RouteHandler<typeof publishFormRoute> = async (c) => {
  const { formId } = c.req.valid('param');
  const form = await publishForm(formId);
  return c.json(form as any, 200);
};
formDesignerRouter.openapi(publishFormRoute, publishFormHandler);

// ============================================================================
// PUT /v1/admin/fields/{fieldId} — update a field
// ============================================================================

const updateFieldRoute = createRoute({
  method: 'put',
  path: '/fields/{fieldId}',
  tags: ['Form Designer'],
  summary: 'Update a field',
  description: 'Update a field. label/hintText/helperText/sortOrder are always editable; fieldType/decimalPlaces/maxLines/lookupSource are rejected with 409 on system-defined fields.',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: {
    params: FieldIdParamSchema,
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: UpdateFieldRequestSchema } } },
  },
  responses: {
    200: { description: 'Field updated', content: { 'application/json': { schema: FieldDefinitionSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Attempted to edit a locked attribute on a system-defined field', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const updateFieldHandler: RouteHandler<typeof updateFieldRoute> = async (c) => {
  const { fieldId } = c.req.valid('param');
  const input = c.req.valid('json');
  const field = await updateField(fieldId, input);
  return c.json(field as any, 200);
};
formDesignerRouter.openapi(updateFieldRoute, updateFieldHandler);

// ============================================================================
// DELETE /v1/admin/fields/{fieldId}
// ============================================================================

const deleteFieldRoute = createRoute({
  method: 'delete',
  path: '/fields/{fieldId}',
  tags: ['Form Designer'],
  summary: 'Delete a field',
  description: 'Delete a user-defined field. System-defined fields cannot be deleted.',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: { params: FieldIdParamSchema, headers: AuthHeaderSchema },
  responses: {
    200: { description: 'Field deleted', content: { 'application/json': { schema: MessageSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Cannot delete a system-defined field', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const deleteFieldHandler: RouteHandler<typeof deleteFieldRoute> = async (c) => {
  const { fieldId } = c.req.valid('param');
  await deleteField(fieldId);
  return c.json({ message: 'Field deleted successfully' }, 200);
};
formDesignerRouter.openapi(deleteFieldRoute, deleteFieldHandler);

// ============================================================================
// PUT /v1/admin/fields/{fieldId}/role-rules — replace the full set
// ============================================================================

const replaceRoleRulesRoute = createRoute({
  method: 'put',
  path: '/fields/{fieldId}/role-rules',
  tags: ['Form Designer'],
  summary: 'Replace role rules',
  description: 'Replace the full set of per-role visibility/requiredness rules for a field',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: {
    params: FieldIdParamSchema,
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: ReplaceRoleRulesRequestSchema } } },
  },
  responses: {
    200: { description: 'Role rules replaced', content: { 'application/json': { schema: z.array(FieldRoleRuleSchema) } } },
    400: { description: 'Duplicate roleId', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Attempted a "required" rule on a system-defined field', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const replaceRoleRulesHandler: RouteHandler<typeof replaceRoleRulesRoute> = async (c) => {
  const { fieldId } = c.req.valid('param');
  const { rules } = c.req.valid('json');
  const result = await replaceFieldRoleRules(fieldId, rules);
  return c.json(result as any, 200);
};
formDesignerRouter.openapi(replaceRoleRulesRoute, replaceRoleRulesHandler);

// ============================================================================
// PUT /v1/admin/fields/{fieldId}/platforms — replace the hidden-platform set
// ============================================================================

const replacePlatformRulesRoute = createRoute({
  method: 'put',
  path: '/fields/{fieldId}/platforms',
  tags: ['Form Designer'],
  summary: 'Replace platform visibility',
  description: 'Replace the full set of platforms this field is hidden on. Omit a platform (or send an empty hiddenOn) to make it visible everywhere.',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: {
    params: FieldIdParamSchema,
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: ReplacePlatformRulesRequestSchema } } },
  },
  responses: {
    200: { description: 'Platform rules replaced', content: { 'application/json': { schema: z.array(FieldPlatformRuleSchema) } } },
    400: { description: 'Duplicate or unknown platform', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const replacePlatformRulesHandler: RouteHandler<typeof replacePlatformRulesRoute> = async (c) => {
  const { fieldId } = c.req.valid('param');
  const { hiddenOn } = c.req.valid('json');
  const result = await replaceFieldPlatformRules(fieldId, hiddenOn);
  return c.json(result as any, 200);
};
formDesignerRouter.openapi(replacePlatformRulesRoute, replacePlatformRulesHandler);

// ============================================================================
// PUT /v1/admin/fields/{fieldId}/validation-rules — replace the full set
// ============================================================================

const replaceValidationRulesRoute = createRoute({
  method: 'put',
  path: '/fields/{fieldId}/validation-rules',
  tags: ['Form Designer'],
  summary: 'Replace validation rules',
  description: 'Replace the full set of validation rules for a field. Rejected entirely on system-defined fields.',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: {
    params: FieldIdParamSchema,
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: ReplaceValidationRulesRequestSchema } } },
  },
  responses: {
    200: { description: 'Validation rules replaced', content: { 'application/json': { schema: z.array(FieldValidationRuleSchema) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Field is system-defined', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const replaceValidationRulesHandler: RouteHandler<typeof replaceValidationRulesRoute> = async (c) => {
  const { fieldId } = c.req.valid('param');
  const { rules } = c.req.valid('json');
  const result = await replaceFieldValidationRules(fieldId, rules);
  return c.json(result as any, 200);
};
formDesignerRouter.openapi(replaceValidationRulesRoute, replaceValidationRulesHandler);

// ============================================================================
// PUT /v1/admin/fields/{fieldId}/options — replace the full option list
// ============================================================================

const replaceOptionsRoute = createRoute({
  method: 'put',
  path: '/fields/{fieldId}/options',
  tags: ['Form Designer'],
  summary: 'Replace dropdown options',
  description: 'Replace the full static option list for a dropdown field. Rejected if the field is not a dropdown (dropdown is always static — lookup fields never take options here).',
  security,
  middleware: [requirePermission('form.manage')] as const,
  request: {
    params: FieldIdParamSchema,
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: ReplaceOptionsRequestSchema } } },
  },
  responses: {
    200: { description: 'Options replaced', content: { 'application/json': { schema: z.array(FieldOptionSchema) } } },
    400: { description: 'Field is not a dropdown, or duplicate codes', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const replaceOptionsHandler: RouteHandler<typeof replaceOptionsRoute> = async (c) => {
  const { fieldId } = c.req.valid('param');
  const { options } = c.req.valid('json');
  const result = await replaceFieldOptions(fieldId, options);
  return c.json(result as any, 200);
};
formDesignerRouter.openapi(replaceOptionsRoute, replaceOptionsHandler);

export { formDesignerRouter };
