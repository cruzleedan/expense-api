import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  decimal,
  date,
  timestamp,
  jsonb,
  vector,
  customType,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ============================================================================
// Helpers
// ============================================================================

/** DECIMAL column whose runtime value is a JS number (via pg type-parser OID 1700). */
const num = (precision: number, scale: number) =>
  decimal({ precision, scale }).$type<number>();

/** PostgreSQL INET type (IP address / CIDR). */
const inet = customType<{ data: string }>({
  dataType: () => 'inet',
});

/** PostgreSQL TSVECTOR type (full-text search vector). */
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

// ============================================================================
// DEPARTMENTS
// ============================================================================

export const departments = pgTable('departments', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  code: varchar({ length: 50 }).unique(),
  parentId: uuid(), // self-ref: departments.id
  headUserId: uuid(), // FK to users.id (added after users table)
  level: integer().default(1),
  fullPath: text(),
  ancestorIds: uuid().array(),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// PROJECTS
// ============================================================================

export const projects = pgTable('projects', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  code: varchar({ length: 50 }).unique(),
  description: text(),
  clientName: varchar({ length: 255 }),
  clientCode: varchar({ length: 50 }),
  clientIndustry: varchar({ length: 100 }),
  clientContactEmail: varchar({ length: 255 }),
  departmentId: uuid(),
  ownerUserId: uuid(),
  status: varchar({ length: 50 }).default('active'),
  budgetAmount: num(14, 2),
  budgetCurrency: varchar({ length: 3 }).default('USD'),
  spentAmount: num(14, 2).default(0),
  remainingAmount: num(14, 2).generatedAlwaysAs(
    sql`budget_amount - spent_amount`
  ),
  utilizationPct: num(7, 2).generatedAlwaysAs(
    sql`CASE WHEN budget_amount > 0 THEN (spent_amount / budget_amount * 100) ELSE 0 END`
  ),
  startDate: date(),
  endDate: date(),
  tags: text().array(),
  fullPath: text(),
  nameEmbedding: vector({ dimensions: 768 }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// USERS
// ============================================================================

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).unique().notNull(),
  firstName: varchar({ length: 100 }),
  lastName: varchar({ length: 100 }),
  displayName: varchar({ length: 255 }).generatedAlwaysAs(
    sql`COALESCE(first_name || ' ' || last_name, email)`
  ),
  isVerified: boolean().notNull().default(false),
  username: varchar({ length: 255 }),
  passwordHash: varchar({ length: 255 }),
  oauthProvider: varchar({ length: 50 }),
  oauthId: varchar({ length: 255 }),
  rolesVersion: integer().notNull().default(1),
  isActive: boolean().notNull().default(true),
  failedLoginAttempts: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true, mode: 'string' }),
  lastLoginAt: timestamp({ withTimezone: true, mode: 'string' }),
  departmentId: uuid(),
  managerId: uuid(), // self-ref: users.id
  costCenter: varchar({ length: 50 }),
  spendingProfile: jsonb().$type<Record<string, unknown>>().default({}),
  llmPreferences: jsonb().$type<Record<string, unknown>>().default({}),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// REFRESH TOKENS
// ============================================================================

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar({ length: 255 }).notNull(),
  expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  ipAddress: inet(),
  userAgent: text(),
  revokedAt: timestamp({ withTimezone: true, mode: 'string' }),
  lastUsedAt: timestamp({ withTimezone: true, mode: 'string' }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// RBAC
// ============================================================================

export const roles = pgTable('roles', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).unique().notNull(),
  description: text(),
  isSystem: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).unique().notNull(),
  description: text(),
  category: varchar({ length: 100 }),
  riskLevel: varchar({ length: 20 }),
  requiresMfa: boolean().default(false),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull().references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
    assignedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })]
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid().notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    grantedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
    grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]
);

export const sodRules = pgTable('sod_rules', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).unique().notNull(),
  description: text(),
  permissionSet: text().array().notNull(),
  riskLevel: varchar({ length: 20 }).default('high'),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// WORKFLOWS
// ============================================================================

export const workflows = pgTable('workflows', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).unique().notNull(),
  description: text(),
  version: integer().notNull().default(1),
  isActive: boolean().notNull().default(true),
  conditions: jsonb().$type<Record<string, unknown>>(),
  steps: jsonb().$type<unknown[]>().notNull(),
  onReturnPolicy: varchar({ length: 50 }).default('hard_restart'),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  createdBy: uuid().references(() => users.id),
});

export const workflowAssignments = pgTable('workflow_assignments', {
  id: uuid().primaryKey().defaultRandom(),
  workflowId: uuid()
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  departmentId: uuid(),
  expenseCategory: varchar({ length: 100 }),
  amountMin: num(12, 2),
  amountMax: num(12, 2),
  priority: integer().default(0),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// EXPENSE REPORTS
// ============================================================================

export const expenseReports = pgTable('expense_reports', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar({ length: 255 }).notNull(),
  description: text(),
  status: varchar({ length: 50 }).default('draft'),
  departmentId: uuid(),
  departmentName: varchar({ length: 255 }),
  costCenter: varchar({ length: 50 }),
  projectId: uuid(),
  projectName: varchar({ length: 255 }),
  clientName: varchar({ length: 255 }),
  tags: text().array(),
  totalAmount: num(12, 2).notNull().default(0),
  netAmount: num(12, 2).notNull().default(0),
  currency: varchar({ length: 3 }).default('USD'),
  lineCount: integer().default(0),
  categoryBreakdown: jsonb().$type<Record<string, number>>().default({}),
  topCategory: varchar({ length: 100 }),
  workflowId: uuid(),
  workflowSnapshot: jsonb().$type<Record<string, unknown>>(),
  currentStep: integer(),
  reportDate: date().notNull().default(sql`CURRENT_DATE`),
  periodStart: date(),
  periodEnd: date(),
  submittedAt: timestamp({ withTimezone: true, mode: 'string' }),
  approvedAt: timestamp({ withTimezone: true, mode: 'string' }),
  postedAt: timestamp({ withTimezone: true, mode: 'string' }),
  paidAt: timestamp({ withTimezone: true, mode: 'string' }),
  paidBy: varchar({ length: 255 }),
  exchangeRate: num(10, 6).default(1.0),
  baseCurrencyTotal: num(12, 2),
  submissionComment: text(),
  rejectionReason: text(),
  processingTimeHours: num(10, 2),
  isOverBudget: boolean().default(false),
  budgetVariancePct: num(5, 2),
  aiSummary: text(),
  contentEmbedding: vector({ dimensions: 768 }),
  version: integer().notNull().default(1),
  clientId: varchar({ length: 36 }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  deletedAt: timestamp({ withTimezone: true, mode: 'string' }),
});

// ============================================================================
// APPROVAL HISTORY
// ============================================================================

export const approvalHistory = pgTable('approval_history', {
  id: uuid().primaryKey().defaultRandom(),
  reportId: uuid()
    .notNull()
    .references(() => expenseReports.id, { onDelete: 'cascade' }),
  stepNumber: integer().notNull(),
  stepName: varchar({ length: 255 }),
  actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar({ length: 255 }),
  action: varchar({ length: 50 }).notNull(),
  comment: text(),
  rejectionCategory: varchar({ length: 100 }),
  reportHash: varchar({ length: 64 }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  slaDeadline: timestamp({ withTimezone: true, mode: 'string' }),
  wasEscalated: boolean().default(false),
});

// ============================================================================
// EXPENSE CATEGORIES
// ============================================================================

export const expenseCategories = pgTable('expense_categories', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 50 }).unique(),
  userGroup: varchar({ length: 100 }),
  description: text(),
  isActive: boolean().notNull().default(true),
  parentId: uuid(), // self-ref: expense_categories.id
  level: integer().default(1),
  fullPath: text(),
  ancestorIds: uuid().array(),
  keywords: text().array(),
  synonyms: text().array(),
  typicalAmountRange: jsonb().$type<Record<string, unknown>>(),
  nameEmbedding: vector({ dimensions: 768 }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// EXPENSE LINES
// ============================================================================

export const expenseLines = pgTable('expense_lines', {
  id: uuid().primaryKey().defaultRandom(),
  reportId: uuid()
    .notNull()
    .references(() => expenseReports.id, { onDelete: 'cascade' }),
  description: varchar({ length: 255 }).notNull(),
  amount: num(12, 2).notNull().default(0),
  originalAmount: num(12, 2),
  currency: varchar({ length: 3 }).default('USD'),
  originalCurrency: varchar({ length: 3 }),
  exchangeRate: num(10, 6),
  categoryId: uuid().references(() => expenseCategories.id),
  category: varchar({ length: 100 }),
  categoryCode: varchar({ length: 50 }),
  categoryPath: text(),
  expenseDate: date('transaction_date').notNull(),
  merchantName: varchar({ length: 255 }),
  merchantCategory: varchar({ length: 100 }),
  locationCity: varchar({ length: 100 }),
  locationCountry: varchar({ length: 3 }),
  isBusinessExpense: boolean().default(false),
  isReimbursable: boolean().default(false),
  reimbursementStatus: varchar({ length: 50 }).default('not_applicable'),
  taxAmount: num(12, 2).default(0),
  taxRate: num(5, 4).default(0),
  notes: text(),
  latitude: num(10, 7),
  longitude: num(10, 7),
  paymentMethod: varchar({ length: 50 }),
  projectId: uuid(),
  projectName: varchar({ length: 255 }),
  clientName: varchar({ length: 255 }),
  tags: text().array(),
  isRecurring: boolean().default(false),
  recurrenceGroupId: uuid(),
  recurrencePattern: varchar({ length: 50 }),
  recurrenceMerchant: varchar({ length: 255 }),
  descriptionEmbedding: vector({ dimensions: 768 }),
  searchVector: tsvector().generatedAlwaysAs(
    sql`setweight(to_tsvector('english', COALESCE(description, '')), 'A') || setweight(to_tsvector('english', COALESCE(merchant_name, '')), 'B') || setweight(to_tsvector('english', COALESCE(category, '')), 'C')`
  ),
  isAnomaly: boolean().default(false),
  anomalyScore: num(5, 4),
  anomalyReasons: text().array(),
  clientId: varchar({ length: 36 }),
  version: integer().notNull().default(1),
  deletedAt: timestamp({ withTimezone: true, mode: 'string' }),
  fiscalYear: integer().generatedAlwaysAs(
    sql`EXTRACT(YEAR FROM transaction_date)`
  ),
  fiscalQuarter: integer().generatedAlwaysAs(
    sql`EXTRACT(QUARTER FROM transaction_date)`
  ),
  fiscalMonth: integer().generatedAlwaysAs(
    sql`EXTRACT(MONTH FROM transaction_date)`
  ),
  fiscalWeek: integer().generatedAlwaysAs(
    sql`EXTRACT(WEEK FROM transaction_date)`
  ),
  dayOfWeek: integer().generatedAlwaysAs(
    sql`EXTRACT(DOW FROM transaction_date)`
  ),
  isWeekend: boolean().generatedAlwaysAs(
    sql`EXTRACT(DOW FROM transaction_date) IN (0, 6)`
  ),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// RECEIPTS
// ============================================================================

export const receipts = pgTable('receipts', {
  id: uuid().primaryKey().defaultRandom(),
  reportId: uuid()
    .notNull()
    .references(() => expenseReports.id, { onDelete: 'cascade' }),
  filePath: varchar({ length: 500 }).notNull(),
  fileName: varchar({ length: 255 }).notNull(),
  fileHash: varchar({ length: 64 }).notNull().unique(),
  mimeType: varchar({ length: 100 }).notNull(),
  fileSize: integer().notNull(),
  thumbnailPath: varchar({ length: 500 }),
  parsedData: jsonb().$type<Record<string, unknown>>(),
  extractedMerchant: varchar({ length: 255 }),
  extractedAmount: num(12, 2),
  extractedCurrency: varchar({ length: 3 }),
  extractedDate: date(),
  extractedItems: jsonb().$type<unknown[]>(),
  ocrText: text(),
  ocrConfidence: num(5, 4),
  contentEmbedding: vector({ dimensions: 768 }),
  searchVector: tsvector().generatedAlwaysAs(
    sql`to_tsvector('english', COALESCE(ocr_text, '') || ' ' || COALESCE(extracted_merchant, ''))`
  ),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const receiptLineAssociations = pgTable(
  'receipt_line_associations',
  {
    receiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    lineId: uuid()
      .notNull()
      .references(() => expenseLines.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.receiptId, t.lineId] })]
);

// ============================================================================
// AUDIT LOGS
// ============================================================================

export const auditLogs = pgTable('audit_logs', {
  id: uuid().primaryKey().defaultRandom(),
  eventId: uuid().unique().notNull().defaultRandom(),
  timestamp: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar({ length: 255 }),
  actorRoles: text().array(),
  ipAddress: inet(),
  userAgent: text(),
  sessionId: uuid(),
  action: varchar({ length: 255 }).notNull(),
  actionCategory: varchar({ length: 100 }),
  resourceType: varchar({ length: 100 }).notNull(),
  resourceId: varchar({ length: 255 }),
  resourceVersion: integer(),
  changes: jsonb().$type<Record<string, unknown>>(),
  metadata: jsonb().$type<Record<string, unknown>>(),
  dataHash: varchar({ length: 64 }).notNull(),
  chainHash: varchar({ length: 64 }),
  previousEventId: uuid(),
  isSensitive: boolean().default(false),
  retentionYears: integer().default(7),
});

// ============================================================================
// LLM ANALYTICS TABLES
// ============================================================================

export const spendingSummaries = pgTable('spending_summaries', {
  id: uuid().primaryKey().defaultRandom(),
  periodType: varchar({ length: 20 }).notNull(),
  periodStart: date().notNull(),
  periodEnd: date().notNull(),
  fiscalYear: integer(),
  fiscalQuarter: integer(),
  fiscalMonth: integer(),
  userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
  departmentId: uuid(),
  categoryId: uuid(),
  costCenter: varchar({ length: 50 }),
  totalAmount: num(14, 2).notNull().default(0),
  transactionCount: integer().notNull().default(0),
  reportCount: integer().notNull().default(0),
  avgTransaction: num(12, 2),
  medianTransaction: num(12, 2),
  maxTransaction: num(12, 2),
  minTransaction: num(12, 2),
  stdDeviation: num(12, 2),
  prevPeriodAmount: num(14, 2),
  amountChange: num(14, 2),
  pctChange: num(7, 2),
  categoryBreakdown: jsonb().$type<Record<string, number>>().default({}),
  topMerchants: jsonb().$type<unknown[]>().default(sql`'[]'::jsonb`),
  narrativeSummary: text(),
  computedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const expenseAnomalies = pgTable('expense_anomalies', {
  id: uuid().primaryKey().defaultRandom(),
  expenseLineId: uuid().references(() => expenseLines.id, { onDelete: 'cascade' }),
  reportId: uuid().references(() => expenseReports.id, { onDelete: 'cascade' }),
  userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
  anomalyType: varchar({ length: 100 }).notNull(),
  severity: varchar({ length: 20 }).notNull(),
  confidence: num(5, 4).notNull(),
  context: jsonb().$type<Record<string, unknown>>().notNull(),
  explanation: text().notNull(),
  status: varchar({ length: 50 }).default('open'),
  reviewedBy: uuid().references(() => users.id),
  reviewedAt: timestamp({ withTimezone: true, mode: 'string' }),
  reviewNotes: text(),
  detectedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const expenseInsights = pgTable('expense_insights', {
  id: uuid().primaryKey().defaultRandom(),
  scopeType: varchar({ length: 50 }).notNull(),
  scopeId: uuid(),
  periodStart: date(),
  periodEnd: date(),
  insightType: varchar({ length: 100 }).notNull(),
  title: varchar({ length: 255 }).notNull(),
  content: text().notNull(),
  supportingData: jsonb().$type<Record<string, unknown>>(),
  relatedEntityIds: uuid().array(),
  confidence: num(5, 4),
  relevanceScore: num(5, 4),
  isPinned: boolean().default(false),
  isStale: boolean().default(false),
  expiresAt: timestamp({ withTimezone: true, mode: 'string' }),
  generatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
  generatedBy: varchar({ length: 100 }).default('system'),
  contentEmbedding: vector({ dimensions: 768 }),
});

export const llmQueries = pgTable('llm_queries', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid(),
  queryText: text().notNull(),
  queryEmbedding: vector({ dimensions: 768 }),
  parsedIntent: jsonb().$type<Record<string, unknown>>(),
  generatedSql: text(),
  responseText: text(),
  responseData: jsonb().$type<Record<string, unknown>>(),
  resultCount: integer(),
  wasHelpful: boolean(),
  userFeedback: text(),
  executionTimeMs: integer(),
  tokensUsed: integer(),
  modelUsed: varchar({ length: 100 }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const merchants = pgTable('merchants', {
  id: uuid().primaryKey().defaultRandom(),
  rawName: varchar({ length: 255 }).notNull().unique(),
  normalizedName: varchar({ length: 255 }).notNull(),
  categoryId: uuid().references(() => expenseCategories.id),
  merchantType: varchar({ length: 100 }),
  typicalAmountRange: jsonb().$type<Record<string, unknown>>(),
  nameEmbedding: vector({ dimensions: 768 }),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const budgets = pgTable('budgets', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
  departmentId: uuid(),
  categoryId: uuid().references(() => expenseCategories.id, { onDelete: 'cascade' }),
  costCenter: varchar({ length: 50 }),
  periodType: varchar({ length: 20 }).notNull(),
  periodStart: date().notNull(),
  periodEnd: date().notNull(),
  budgetAmount: num(14, 2).notNull(),
  currency: varchar({ length: 3 }).default('USD'),
  spentAmount: num(14, 2).default(0),
  remainingAmount: num(14, 2).generatedAlwaysAs(
    sql`budget_amount - spent_amount`
  ),
  utilizationPct: num(7, 2).generatedAlwaysAs(
    sql`CASE WHEN budget_amount > 0 THEN (spent_amount / budget_amount * 100) ELSE 0 END`
  ),
  alertThresholdPct: num(5, 2).default(80.00),
  alertSent: boolean().default(false),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const expensePolicies = pgTable('expense_policies', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  code: varchar({ length: 50 }).unique(),
  description: text().notNull(),
  appliesToCategories: uuid().array(),
  appliesToDepartments: uuid().array(),
  appliesToRoles: text().array(),
  ruleType: varchar({ length: 50 }).notNull(),
  ruleConfig: jsonb().$type<Record<string, unknown>>().notNull(),
  violationMessage: text().notNull(),
  severity: varchar({ length: 20 }).default('warning'),
  isActive: boolean().notNull().default(true),
  effectiveDate: date(),
  expiryDate: date(),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  createdBy: uuid().references(() => users.id),
});

export const llmPromptTemplates = pgTable('llm_prompt_templates', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).unique().notNull(),
  description: text(),
  systemPrompt: text(),
  userPromptTemplate: text().notNull(),
  requiredContext: text().array(),
  outputFormat: varchar({ length: 50 }).default('text'),
  preferredModel: varchar({ length: 100 }),
  maxTokens: integer().default(1000),
  temperature: num(3, 2).default(0.3),
  version: integer().notNull().default(1),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ============================================================================
// Exported types (camelCase, matching Zod schemas)
// ============================================================================

export type Department = InferSelectModel<typeof departments>;
export type Project = InferSelectModel<typeof projects>;
export type User = InferSelectModel<typeof users>;
export type RefreshToken = InferSelectModel<typeof refreshTokens>;
export type Role = InferSelectModel<typeof roles>;
export type Permission = InferSelectModel<typeof permissions>;
export type UserRole = InferSelectModel<typeof userRoles>;
export type RolePermission = InferSelectModel<typeof rolePermissions>;
export type SodRule = InferSelectModel<typeof sodRules>;
export type Workflow = InferSelectModel<typeof workflows>;
export type WorkflowAssignment = InferSelectModel<typeof workflowAssignments>;
export type ExpenseReport = InferSelectModel<typeof expenseReports>;
export type ApprovalHistory = InferSelectModel<typeof approvalHistory>;
export type ExpenseCategory = InferSelectModel<typeof expenseCategories>;
export type ExpenseLine = InferSelectModel<typeof expenseLines>;
export type Receipt = InferSelectModel<typeof receipts>;
export type ReceiptLineAssociation = InferSelectModel<typeof receiptLineAssociations>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type SpendingSummary = InferSelectModel<typeof spendingSummaries>;
export type ExpenseAnomaly = InferSelectModel<typeof expenseAnomalies>;
export type ExpenseInsight = InferSelectModel<typeof expenseInsights>;
export type LlmQuery = InferSelectModel<typeof llmQueries>;
export type Merchant = InferSelectModel<typeof merchants>;
export type Budget = InferSelectModel<typeof budgets>;
export type ExpensePolicy = InferSelectModel<typeof expensePolicies>;
export type LlmPromptTemplate = InferSelectModel<typeof llmPromptTemplates>;

export type NewExpenseReport = InferInsertModel<typeof expenseReports>;
export type NewExpenseLine = InferInsertModel<typeof expenseLines>;
export type NewExpenseCategory = InferInsertModel<typeof expenseCategories>;
export type NewExpensePolicy = InferInsertModel<typeof expensePolicies>;
export type NewReceipt = InferInsertModel<typeof receipts>;
export type NewUser = InferInsertModel<typeof users>;
export type NewProject = InferInsertModel<typeof projects>;
