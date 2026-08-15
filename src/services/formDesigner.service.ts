import { query, transaction } from '../db/client.js';
import { NotFoundError, ConflictError, ValidationError } from '../types/index.js';
import {
  buildOrderByClause,
  getOffset,
  type PaginationParams,
} from '../utils/pagination.js';

// ============================================================================
// Types (snake_case, mirroring DB columns — see src/db/schema.sql)
// ============================================================================

// WORK-0013: dropdown is now always static; lookup is the client-resolved
// case that used to live inside dropdown via options_source.
export type FieldType = 'text' | 'decimal' | 'date' | 'dropdown' | 'toggle' | 'lookup';
export type FormStatus = 'draft' | 'published';
export type RoleRuleState = 'required' | 'hidden' | 'read_only';
export type Platform = 'mobile' | 'web' | 'mcp';
export type ValidationRuleType =
  | 'min_length' | 'max_length' | 'email' | 'required'
  | 'number_gt' | 'number_lt' | 'number_gte' | 'number_lte' | 'number_eq' | 'pattern';

export interface FormDefinition {
  id: string;
  screen_id: string;
  name: string;
  version: number;
  status: FormStatus;
  is_locked: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface FieldDefinition {
  id: string;
  form_id: string;
  field_key: string;
  field_type: FieldType;
  label: string;
  is_system_defined: boolean;
  sort_order: number;
  hint_text: string | null;
  helper_text: string | null;
  decimal_places: number | null;
  max_lines: number | null;
  lookup_source: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FieldRoleRule {
  id: string;
  field_id: string;
  role_id: string;
  state: RoleRuleState;
}

export interface FieldPlatformRule {
  id: string;
  field_id: string;
  platform: Platform;
}

export interface FieldValidationRule {
  id: string;
  field_id: string;
  rule_type: ValidationRuleType;
  rule_value: string | null;
  error_message: string | null;
  sort_order: number;
}

export interface FieldOption {
  id: string;
  field_id: string;
  code: string;
  value: string;
  sort_order: number;
  is_active: boolean;
}

export interface FieldDefinitionWithRules extends FieldDefinition {
  role_rules: FieldRoleRule[];
  platform_rules: FieldPlatformRule[];
  validation_rules: FieldValidationRule[];
  options: FieldOption[];
}

const FORM_SORTABLE_FIELDS: Record<string, string> = {
  screenId: 'screen_id',
  name: 'name',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ============================================================================
// Forms
// ============================================================================

export async function listForms(
  params: PaginationParams,
  filters: { status?: FormStatus }
): Promise<{ forms: FormDefinition[]; total: number }> {
  const offset = getOffset(params);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters.status) {
    conditions.push(`status = $${paramIndex}`);
    values.push(filters.status);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = buildOrderByClause(params, FORM_SORTABLE_FIELDS, 'name ASC');

  const [dataResult, countResult] = await Promise.all([
    query<FormDefinition>(
      `SELECT * FROM form_definitions ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(`SELECT COUNT(*) as count FROM form_definitions ${whereClause}`, values),
  ]);

  return { forms: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
}

export interface CreateFormInput {
  screenId: string;
  name: string;
}

export async function createForm(input: CreateFormInput): Promise<FormDefinition> {
  const existing = await query('SELECT id FROM form_definitions WHERE screen_id = $1', [input.screenId]);
  if (existing.rows.length > 0) {
    throw new ConflictError(`A form with screenId "${input.screenId}" already exists`);
  }

  const result = await query<FormDefinition>(
    'INSERT INTO form_definitions (screen_id, name) VALUES ($1, $2) RETURNING *',
    [input.screenId, input.name]
  );
  return result.rows[0];
}

export async function getFormById(formId: string): Promise<FormDefinition> {
  const result = await query<FormDefinition>('SELECT * FROM form_definitions WHERE id = $1', [formId]);
  if (result.rows.length === 0) {
    throw new NotFoundError('Form');
  }
  return result.rows[0];
}

export async function getFormDetail(formId: string): Promise<FormDefinition & { fields: FieldDefinitionWithRules[] }> {
  const form = await getFormById(formId);

  const fieldsResult = await query<FieldDefinition>(
    'SELECT * FROM field_definitions WHERE form_id = $1 ORDER BY sort_order ASC',
    [formId]
  );
  const fields = fieldsResult.rows;
  const fieldIds = fields.map((f) => f.id);

  if (fieldIds.length === 0) {
    return { ...form, fields: [] };
  }

  const [roleRulesResult, platformRulesResult, validationRulesResult, optionsResult] = await Promise.all([
    query<FieldRoleRule>('SELECT * FROM field_role_rules WHERE field_id = ANY($1)', [fieldIds]),
    query<FieldPlatformRule>('SELECT * FROM field_platform_rules WHERE field_id = ANY($1)', [fieldIds]),
    query<FieldValidationRule>('SELECT * FROM field_validation_rules WHERE field_id = ANY($1) ORDER BY sort_order ASC', [fieldIds]),
    query<FieldOption>('SELECT * FROM field_options WHERE field_id = ANY($1) ORDER BY sort_order ASC', [fieldIds]),
  ]);

  const byField = <T extends { field_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.field_id) ?? [];
      list.push(row);
      map.set(row.field_id, list);
    }
    return map;
  };

  const roleRulesByField = byField(roleRulesResult.rows);
  const platformRulesByField = byField(platformRulesResult.rows);
  const validationRulesByField = byField(validationRulesResult.rows);
  const optionsByField = byField(optionsResult.rows);

  return {
    ...form,
    fields: fields.map((field) => ({
      ...field,
      role_rules: roleRulesByField.get(field.id) ?? [],
      platform_rules: platformRulesByField.get(field.id) ?? [],
      validation_rules: validationRulesByField.get(field.id) ?? [],
      options: optionsByField.get(field.id) ?? [],
    })),
  };
}

export async function publishForm(formId: string): Promise<FormDefinition> {
  await getFormById(formId);
  const result = await query<FormDefinition>(
    `UPDATE form_definitions SET status = 'published', version = version + 1, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [formId]
  );
  return result.rows[0];
}

// ============================================================================
// Fields
// ============================================================================

export interface CreateFieldInput {
  fieldKey: string;
  fieldType: FieldType;
  label: string;
  hintText?: string;
  helperText?: string;
  decimalPlaces?: number;
  maxLines?: number;
  lookupSource?: string;
  sortOrder?: number;
}

// WORK-0013: lookupSource is required when fieldType is 'lookup' and
// forbidden otherwise — dropdown is always static now, the ambiguity this
// used to require (dropdown + optional options_source) is gone by
// construction. Shared by create and update.
function assertLookupSourceMatchesType(fieldType: FieldType, lookupSource: string | null | undefined, fieldKeyForError: string): void {
  if (fieldType === 'lookup') {
    if (!lookupSource) {
      throw new ValidationError(`lookupSource is required when fieldType is "lookup" (field "${fieldKeyForError}")`);
    }
  } else if (lookupSource) {
    throw new ValidationError(`lookupSource only applies to lookup fields, not "${fieldType}" (field "${fieldKeyForError}")`);
  }
}

export async function createField(formId: string, input: CreateFieldInput): Promise<FieldDefinition> {
  await getFormById(formId);

  const existing = await query('SELECT id FROM field_definitions WHERE form_id = $1 AND field_key = $2', [formId, input.fieldKey]);
  if (existing.rows.length > 0) {
    throw new ConflictError(`Field with key "${input.fieldKey}" already exists on this form`);
  }

  assertLookupSourceMatchesType(input.fieldType, input.lookupSource, input.fieldKey);

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const maxResult = await query<{ max: number | null }>('SELECT MAX(sort_order) as max FROM field_definitions WHERE form_id = $1', [formId]);
    sortOrder = (maxResult.rows[0].max ?? -1) + 1;
  }

  const result = await query<FieldDefinition>(
    `INSERT INTO field_definitions (
      form_id, field_key, field_type, label, is_system_defined, sort_order,
      hint_text, helper_text, decimal_places, max_lines, lookup_source
    ) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      formId, input.fieldKey, input.fieldType, input.label, sortOrder,
      input.hintText ?? null, input.helperText ?? null,
      input.decimalPlaces ?? null, input.maxLines ?? null, input.lookupSource ?? null,
    ]
  );

  return result.rows[0];
}

export async function getFieldById(fieldId: string): Promise<FieldDefinition> {
  const result = await query<FieldDefinition>('SELECT * FROM field_definitions WHERE id = $1', [fieldId]);
  if (result.rows.length === 0) {
    throw new NotFoundError('Field');
  }
  return result.rows[0];
}

export interface UpdateFieldInput {
  label?: string;
  hintText?: string | null;
  helperText?: string | null;
  sortOrder?: number;
  fieldType?: FieldType;
  decimalPlaces?: number | null;
  maxLines?: number | null;
  lookupSource?: string | null;
}

// Columns locked once a field is system-defined. label/hintText/helperText/
// sortOrder are always editable — see schemas/formDesigner.ts.
const SYSTEM_FIELD_LOCKED_KEYS: (keyof UpdateFieldInput)[] = ['fieldType', 'decimalPlaces', 'maxLines', 'lookupSource'];

export async function updateField(fieldId: string, input: UpdateFieldInput): Promise<FieldDefinition> {
  const existing = await getFieldById(fieldId);

  if (existing.is_system_defined) {
    const attemptedLockedKeys = SYSTEM_FIELD_LOCKED_KEYS.filter((key) => input[key] !== undefined);
    if (attemptedLockedKeys.length > 0) {
      throw new ConflictError(
        `Cannot edit ${attemptedLockedKeys.join(', ')} on system-defined field "${existing.field_key}" — only label, hintText, helperText, and sortOrder are editable`
      );
    }
  }

  if (input.fieldType !== undefined || input.lookupSource !== undefined) {
    const resultingFieldType = input.fieldType ?? existing.field_type;
    const resultingLookupSource = input.lookupSource !== undefined ? input.lookupSource : existing.lookup_source;
    assertLookupSourceMatchesType(resultingFieldType, resultingLookupSource, existing.field_key);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const set = (column: string, value: unknown) => {
    updates.push(`${column} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  };

  if (input.label !== undefined) set('label', input.label);
  if (input.hintText !== undefined) set('hint_text', input.hintText);
  if (input.helperText !== undefined) set('helper_text', input.helperText);
  if (input.sortOrder !== undefined) set('sort_order', input.sortOrder);
  if (input.fieldType !== undefined) set('field_type', input.fieldType);
  if (input.decimalPlaces !== undefined) set('decimal_places', input.decimalPlaces);
  if (input.maxLines !== undefined) set('max_lines', input.maxLines);
  if (input.lookupSource !== undefined) set('lookup_source', input.lookupSource);

  if (updates.length === 0) {
    return existing;
  }

  values.push(fieldId);
  const result = await query<FieldDefinition>(
    `UPDATE field_definitions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function deleteField(fieldId: string): Promise<void> {
  const existing = await getFieldById(fieldId);
  if (existing.is_system_defined) {
    throw new ConflictError(`Cannot delete system-defined field "${existing.field_key}"`);
  }
  await query('DELETE FROM field_definitions WHERE id = $1', [fieldId]);
}

// ============================================================================
// Role rules
// ============================================================================

export interface RoleRuleInput {
  roleId: string;
  state: RoleRuleState;
}

// Role rules are always a full-replace (matches the option-list and
// validation-rule endpoints) — the designer sends the complete set for a
// field each time, not incremental add/remove.
export async function replaceFieldRoleRules(fieldId: string, rules: RoleRuleInput[]): Promise<FieldRoleRule[]> {
  const field = await getFieldById(fieldId);

  // System-defined fields may be hidden/read-only per role, but never
  // per-role required — see context/work/0010, data model callout.
  if (field.is_system_defined) {
    const hasRequired = rules.some((r) => r.state === 'required');
    if (hasRequired) {
      throw new ConflictError(
        `Cannot set a "required" role rule on system-defined field "${field.field_key}" — its required-ness is fixed by app logic, not admin-configurable`
      );
    }
  }

  const roleIds = rules.map((r) => r.roleId);
  const uniqueRoleIds = new Set(roleIds);
  if (uniqueRoleIds.size !== roleIds.length) {
    throw new ValidationError('Duplicate roleId in role rules — one rule per role per field');
  }

  return transaction(async (client) => {
    await client.query('DELETE FROM field_role_rules WHERE field_id = $1', [fieldId]);
    const inserted: FieldRoleRule[] = [];
    for (const rule of rules) {
      const result = await client.query<FieldRoleRule>(
        'INSERT INTO field_role_rules (field_id, role_id, state) VALUES ($1, $2, $3) RETURNING *',
        [fieldId, rule.roleId, rule.state]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });
}

// ============================================================================
// Platform rules
// ============================================================================

const ALL_PLATFORMS: Platform[] = ['mobile', 'web', 'mcp'];

// A row's mere existence means "hidden on this platform" — there's no
// per-platform required/read_only concept, unlike role rules. hiddenOn is
// the full desired hidden-set, replacing whatever's there today, same
// replace-not-diff semantics as replaceFieldRoleRules/replaceFieldOptions.
export async function replaceFieldPlatformRules(fieldId: string, hiddenOn: Platform[]): Promise<FieldPlatformRule[]> {
  await getFieldById(fieldId);

  const unique = new Set(hiddenOn);
  if (unique.size !== hiddenOn.length) {
    throw new ValidationError('Duplicate platform in platform rules — one rule per platform per field');
  }
  const invalid = hiddenOn.filter((p) => !ALL_PLATFORMS.includes(p));
  if (invalid.length > 0) {
    throw new ValidationError(`Unknown platform(s): ${invalid.join(', ')}`);
  }

  return transaction(async (client) => {
    await client.query('DELETE FROM field_platform_rules WHERE field_id = $1', [fieldId]);
    const inserted: FieldPlatformRule[] = [];
    for (const platform of hiddenOn) {
      const result = await client.query<FieldPlatformRule>(
        'INSERT INTO field_platform_rules (field_id, platform) VALUES ($1, $2) RETURNING *',
        [fieldId, platform]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });
}

// ============================================================================
// Validation rules
// ============================================================================

export interface ValidationRuleInput {
  ruleType: ValidationRuleType;
  ruleValue?: string;
  errorMessage?: string;
  sortOrder?: number;
}

export async function replaceFieldValidationRules(fieldId: string, rules: ValidationRuleInput[]): Promise<FieldValidationRule[]> {
  const field = await getFieldById(fieldId);

  // Validation rules on system-defined fields are not editable in v1 —
  // context/work/0010, data model callout. Reject the whole request rather
  // than silently filtering, so the designer surfaces a clear error.
  if (field.is_system_defined && rules.length > 0) {
    throw new ConflictError(`Cannot set validation rules on system-defined field "${field.field_key}"`);
  }

  return transaction(async (client) => {
    await client.query('DELETE FROM field_validation_rules WHERE field_id = $1', [fieldId]);
    const inserted: FieldValidationRule[] = [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const result = await client.query<FieldValidationRule>(
        `INSERT INTO field_validation_rules (field_id, rule_type, rule_value, error_message, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [fieldId, rule.ruleType, rule.ruleValue ?? null, rule.errorMessage ?? null, rule.sortOrder ?? i]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });
}

// ============================================================================
// Options
// ============================================================================

export interface OptionInput {
  code: string;
  value: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function replaceFieldOptions(fieldId: string, options: OptionInput[]): Promise<FieldOption[]> {
  const field = await getFieldById(fieldId);

  // WORK-0013: dropdown is always static now — a dropdown field can no
  // longer have a lookup_source to conflict with, so this check alone is
  // sufficient (it used to also need a separate options_source check here).
  if (field.field_type !== 'dropdown') {
    throw new ValidationError(`Field "${field.field_key}" is not a dropdown field — options only apply to dropdown fields`);
  }

  const codes = options.map((o) => o.code);
  if (new Set(codes).size !== codes.length) {
    throw new ValidationError('Duplicate option code — codes must be unique per field');
  }

  return transaction(async (client) => {
    await client.query('DELETE FROM field_options WHERE field_id = $1', [fieldId]);
    const inserted: FieldOption[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const result = await client.query<FieldOption>(
        `INSERT INTO field_options (field_id, code, value, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [fieldId, opt.code, opt.value, opt.sortOrder ?? i, opt.isActive ?? true]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });
}

// ============================================================================
// Client-facing assembly — GET /v1/ui-schemas/{screenId}
// ============================================================================

// WORK-0013: the wire `type` never includes 'lookup' — see the
// serialization note in getUiSchema() below. This is a narrower type than
// the internal FieldType on purpose.
export type UiFieldType = 'text' | 'decimal' | 'date' | 'dropdown' | 'toggle';

export interface UiField {
  key: string;
  type: UiFieldType;
  label: string;
  required: boolean;
  hintText: string | null;
  helperText: string | null;
  decimalPlaces: number | null;
  maxLines: number | null;
  options: { value: string; label: string }[] | null;
  optionsSource: string | null;
  isEnabled: boolean;
  validation: {
    minValue: number | null;
    maxValue: number | null;
    maxLength: number | null;
    pattern: string | null;
    patternMessage: string | null;
  };
}

export interface UiSchema {
  screenId: string;
  version: number;
  fields: UiField[];
}

/**
 * Maps validation rules for one field onto the client's fixed vocabulary
 * (minValue/maxValue/maxLength/pattern/patternMessage). Strict inequalities
 * (number_gt/number_lt) and number_eq collapse into the inclusive
 * min/max the client already treats as >=/<= — see Flutter follow-up #3 in
 * the handoff doc. email has no client-side representation yet and is
 * dropped (not approximated as a pattern here, to avoid silently shipping
 * a guessed regex as if the designer had configured it).
 */
function mapValidation(rules: FieldValidationRule[]): UiField['validation'] {
  const result: UiField['validation'] = {
    minValue: null,
    maxValue: null,
    maxLength: null,
    pattern: null,
    patternMessage: null,
  };

  for (const rule of rules) {
    const numericValue = rule.rule_value !== null ? Number(rule.rule_value) : null;
    switch (rule.rule_type) {
      case 'number_gte':
      case 'number_gt':
        if (numericValue !== null) result.minValue = numericValue;
        break;
      case 'number_lte':
      case 'number_lt':
        if (numericValue !== null) result.maxValue = numericValue;
        break;
      case 'max_length':
        if (numericValue !== null) result.maxLength = numericValue;
        break;
      case 'pattern':
        result.pattern = rule.rule_value;
        if (rule.error_message) result.patternMessage = rule.error_message;
        break;
      // min_length, email, required, number_eq: no client-side field yet.
      default:
        break;
    }
  }

  return result;
}

export async function getUiSchema(screenId: string, roleName: string | undefined, platform?: Platform): Promise<UiSchema> {
  const formResult = await query<FormDefinition>(
    "SELECT * FROM form_definitions WHERE screen_id = $1 AND status = 'published'",
    [screenId]
  );
  if (formResult.rows.length === 0) {
    throw new NotFoundError('Published form');
  }
  const form = formResult.rows[0];

  const fieldsResult = await query<FieldDefinition>(
    'SELECT * FROM field_definitions WHERE form_id = $1 ORDER BY sort_order ASC',
    [form.id]
  );
  const fields = fieldsResult.rows;
  if (fields.length === 0) {
    return { screenId: form.screen_id, version: form.version, fields: [] };
  }
  const fieldIds = fields.map((f) => f.id);

  let roleId: string | null = null;
  if (roleName) {
    const roleResult = await query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [roleName]);
    roleId = roleResult.rows[0]?.id ?? null;
    // Unknown role name: fall through with roleId = null, same as no role
    // rules existing — every field resolves to its default state rather
    // than erroring, since a typo'd role shouldn't take down the form.
  }

  const [roleRulesResult, validationRulesResult, optionsResult, platformRulesResult] = await Promise.all([
    roleId
      ? query<FieldRoleRule>('SELECT * FROM field_role_rules WHERE field_id = ANY($1) AND role_id = $2', [fieldIds, roleId])
      : Promise.resolve({ rows: [] as FieldRoleRule[] }),
    query<FieldValidationRule>('SELECT * FROM field_validation_rules WHERE field_id = ANY($1) ORDER BY sort_order ASC', [fieldIds]),
    query<FieldOption>('SELECT * FROM field_options WHERE field_id = ANY($1) AND is_active = true ORDER BY sort_order ASC', [fieldIds]),
    platform
      ? query<FieldPlatformRule>('SELECT * FROM field_platform_rules WHERE field_id = ANY($1) AND platform = $2', [fieldIds, platform])
      : Promise.resolve({ rows: [] as FieldPlatformRule[] }),
  ]);

  const roleRuleByField = new Map(roleRulesResult.rows.map((r) => [r.field_id, r]));
  const hiddenByPlatform = new Set(platformRulesResult.rows.map((r) => r.field_id));
  const validationRulesByField = new Map<string, FieldValidationRule[]>();
  for (const rule of validationRulesResult.rows) {
    const list = validationRulesByField.get(rule.field_id) ?? [];
    list.push(rule);
    validationRulesByField.set(rule.field_id, list);
  }
  const optionsByField = new Map<string, FieldOption[]>();
  for (const opt of optionsResult.rows) {
    const list = optionsByField.get(opt.field_id) ?? [];
    list.push(opt);
    optionsByField.set(opt.field_id, list);
  }

  const uiFields: UiField[] = [];

  for (const field of fields) {
    const roleRule = roleRuleByField.get(field.id);

    // Hidden fields are dropped entirely, not sent with a flag — the
    // Flutter client has no concept of a hidden field yet.
    if (roleRule?.state === 'hidden') {
      continue;
    }

    // WORK-0014: same drop-don't-flag handling as role-hidden fields.
    // hiddenByPlatform is only ever populated when a platform was passed —
    // omitting ?platform= reproduces today's exact output unchanged.
    if (hiddenByPlatform.has(field.id)) {
      continue;
    }

    const isReadOnly = roleRule?.state === 'read_only';

    // System-defined fields default to required=true (matching WORK-0021's
    // hardcoded behavior today) since a per-role "required" rule is never
    // allowed for them (enforced in replaceFieldRoleRules). A read-only
    // field can't sensibly be "required" — there's no input to require.
    // User-defined fields have no such default: required only when an
    // explicit role rule says so.
    const required = field.is_system_defined
      ? !isReadOnly
      : roleRule?.state === 'required';

    // WORK-0013 compatibility shim: 'lookup' is an internal-only field_type
    // (added to split it out of dropdown's old dual-mode). The wire
    // contract is WORK-0021's already-shipped Flutter format, which has no
    // 'lookup' case — so a lookup field is serialized exactly the way a
    // dropdown+optionsSource field always has been: type "dropdown",
    // optionsSource set, options null. A real dropdown (always static now)
    // serializes as type "dropdown", options from field_options, no
    // optionsSource. Do NOT "simplify" this by emitting a real "lookup"
    // wire type until Flutter has a follow-up that understands it — see
    // context/work/0013-lookup-field-type.md.
    const wireType: UiFieldType = field.field_type === 'lookup' ? 'dropdown' : field.field_type;
    const wireOptionsSource = field.field_type === 'lookup' ? field.lookup_source : null;
    const options = field.field_type === 'dropdown'
      ? (optionsByField.get(field.id) ?? []).map((o) => ({ value: o.code, label: o.value }))
      : null;

    uiFields.push({
      key: field.field_key,
      type: wireType,
      label: field.label,
      required,
      hintText: field.hint_text,
      helperText: field.helper_text,
      decimalPlaces: field.decimal_places,
      maxLines: field.max_lines,
      options,
      optionsSource: wireOptionsSource,
      isEnabled: !isReadOnly,
      validation: mapValidation(validationRulesByField.get(field.id) ?? []),
    });
  }

  return { screenId: form.screen_id, version: form.version, fields: uiFields };
}
