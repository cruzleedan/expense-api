import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

// ============================================================================
// Enums
// ============================================================================

export const FieldTypeSchema = z.enum(['text', 'decimal', 'date', 'dropdown', 'toggle']);
export const FormStatusSchema = z.enum(['draft', 'published']);
export const RoleRuleStateSchema = z.enum(['required', 'hidden', 'read_only']);
export const ValidationRuleTypeSchema = z.enum([
  'min_length', 'max_length', 'email', 'required',
  'number_gt', 'number_lt', 'number_gte', 'number_lte', 'number_eq', 'pattern',
]);

// ============================================================================
// Resource schemas (admin/designer shape — snake_case DB fields transformed
// to camelCase by the global camelCaseResponse middleware, same as every
// other resource in this API)
// ============================================================================

export const FieldOptionSchema = z.object({
  id: z.string().uuid(),
  fieldId: z.string().uuid(),
  code: z.string(),
  value: z.string(),
  sortOrder: z.number(),
  isActive: z.boolean(),
}).openapi('FieldOption');

export const FieldRoleRuleSchema = z.object({
  id: z.string().uuid(),
  fieldId: z.string().uuid(),
  roleId: z.string().uuid(),
  state: RoleRuleStateSchema,
}).openapi('FieldRoleRule');

export const FieldValidationRuleSchema = z.object({
  id: z.string().uuid(),
  fieldId: z.string().uuid(),
  ruleType: ValidationRuleTypeSchema,
  ruleValue: z.string().nullable(),
  errorMessage: z.string().nullable(),
  sortOrder: z.number(),
}).openapi('FieldValidationRule');

export const FieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  fieldKey: z.string(),
  fieldType: FieldTypeSchema,
  label: z.string(),
  isSystemDefined: z.boolean(),
  sortOrder: z.number(),
  hintText: z.string().nullable(),
  helperText: z.string().nullable(),
  decimalPlaces: z.number().nullable(),
  maxLines: z.number().nullable(),
  optionsSource: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('FieldDefinition');

export const FieldDefinitionWithRulesSchema = FieldDefinitionSchema.extend({
  roleRules: z.array(FieldRoleRuleSchema),
  validationRules: z.array(FieldValidationRuleSchema),
  options: z.array(FieldOptionSchema),
}).openapi('FieldDefinitionWithRules');

export const FormDefinitionSchema = z.object({
  id: z.string().uuid(),
  screenId: z.string(),
  name: z.string(),
  version: z.number(),
  status: FormStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('FormDefinition');

export const FormDefinitionDetailSchema = FormDefinitionSchema.extend({
  fields: z.array(FieldDefinitionWithRulesSchema),
}).openapi('FormDefinitionDetail');

// ============================================================================
// Request schemas — designer CRUD
// ============================================================================

export const CreateFormRequestSchema = z.object({
  screenId: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'screenId must be lowercase snake_case (matches the client\'s screenId)'),
  name: z.string().min(1).max(255),
}).openapi('CreateFormRequest');

export const CreateFieldRequestSchema = z.object({
  fieldKey: z.string().min(1).max(100).regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'Field key must be a valid identifier (camelCase, no spaces)'),
  fieldType: FieldTypeSchema,
  label: z.string().min(1).max(255),
  hintText: z.string().max(500).optional(),
  helperText: z.string().max(500).optional(),
  decimalPlaces: z.number().int().min(0).max(10).optional(),
  maxLines: z.number().int().positive().optional(),
  optionsSource: z.string().max(100).optional(),
  sortOrder: z.number().int().optional().openapi({ description: 'Defaults to end of the list when omitted' }),
}).openapi('CreateFieldRequest');

// label/hintText/helperText/sortOrder are always editable, even on
// system-defined fields. fieldType/decimalPlaces/maxLines/optionsSource are
// rejected with 409 when the target field is system-defined — see
// context/work/0010-dynamic-form-designer-api.md, data model callout.
// fieldKey and isSystemDefined are immutable and not accepted here at all.
export const UpdateFieldRequestSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  hintText: z.string().max(500).nullable().optional(),
  helperText: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  fieldType: FieldTypeSchema.optional(),
  decimalPlaces: z.number().int().min(0).max(10).nullable().optional(),
  maxLines: z.number().int().positive().nullable().optional(),
  optionsSource: z.string().max(100).nullable().optional(),
}).openapi('UpdateFieldRequest');

export const ReplaceRoleRulesRequestSchema = z.object({
  rules: z.array(z.object({
    roleId: z.string().uuid(),
    state: RoleRuleStateSchema,
  })),
}).openapi('ReplaceRoleRulesRequest');

export const ReplaceValidationRulesRequestSchema = z.object({
  rules: z.array(z.object({
    ruleType: ValidationRuleTypeSchema,
    ruleValue: z.string().max(255).optional(),
    errorMessage: z.string().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })),
}).openapi('ReplaceValidationRulesRequest');

export const ReplaceOptionsRequestSchema = z.object({
  options: z.array(z.object({
    code: z.string().min(1).max(100),
    value: z.string().min(1).max(255),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })),
}).openapi('ReplaceOptionsRequest');

// ============================================================================
// List / param schemas
// ============================================================================

export const FormListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  status: FormStatusSchema.optional(),
});

export const FormListResponseSchema = z.object({
  data: z.array(FormDefinitionSchema),
  pagination: PaginationMetaSchema,
}).openapi('FormListResponse');

export const FormIdParamSchema = z.object({
  formId: z.string().uuid(),
}).openapi('FormIdParam');

export const FieldIdParamSchema = z.object({
  fieldId: z.string().uuid(),
}).openapi('FieldIdParam');

export const ScreenIdParamSchema = z.object({
  screenId: z.string().min(1).max(100),
}).openapi('ScreenIdParam');

export const UiSchemaQuerySchema = z.object({
  role: z.string().max(100).optional().openapi({ description: "Requesting user's role code; defaults to no role-specific rules applied (base schema) when omitted" }),
});

// ============================================================================
// Client-facing read contract — matches WORK-0021's existing Flutter parser
// exactly (FormSchema.fromJson / FieldSchema.fromJson). Field names here are
// NOT camelCase-transformed DB columns; they're hand-picked to match the
// wire format the client already speaks (`key`, not `fieldKey`).
// ============================================================================

export const UiFieldValidationSchema = z.object({
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  maxLength: z.number().nullable(),
  pattern: z.string().nullable(),
  patternMessage: z.string().nullable(),
});

export const UiFieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const UiFieldSchema = z.object({
  key: z.string(),
  type: FieldTypeSchema,
  label: z.string(),
  required: z.boolean(),
  hintText: z.string().nullable(),
  helperText: z.string().nullable(),
  decimalPlaces: z.number().nullable(),
  maxLines: z.number().nullable(),
  options: z.array(UiFieldOptionSchema).nullable(),
  optionsSource: z.string().nullable(),
  isEnabled: z.boolean().openapi({ description: 'false when the role-rule state is read_only for the requesting role. Requires Flutter follow-up #2 to be honored client-side — see the handoff doc.' }),
  validation: UiFieldValidationSchema,
}).openapi('UiField');

export const UiSchemaResponseSchema = z.object({
  screenId: z.string(),
  version: z.number(),
  fields: z.array(UiFieldSchema),
}).openapi('UiSchemaResponse');
