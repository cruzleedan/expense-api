/** WORK-0047: new capabilities never flow to ordinary administrators implicitly. */
export const ADMIN_ROLE_CATALOG_VERSION = 'WORK-0047:v1';

export const ORDINARY_SYSTEM_ROLE_NAMES: readonly string[] = [
  'employee', 'approver', 'finance', 'auditor', 'admin',
];

export const ADMIN_PERMISSION_NAMES: readonly string[] = [
  // Read-only report/receipt support. Self-service belongs to employee.
  'report.view.all', 'report.view.archived', 'report.export',
  'attachment.view.all', 'attachment.download',
  // Ordinary role and permission administration, never elevated-role assignment.
  'role.create', 'role.view', 'role.edit', 'role.delete', 'role.assign',
  'permission.view', 'permission.create', 'permission.edit', 'permission.delete',
  'user.create', 'user.view', 'user.view.sensitive', 'user.edit', 'user.edit.own',
  'user.deactivate', 'user.reset_password', 'user.unlock',
  // Definition/configuration management, not execution overrides.
  'workflow.create', 'workflow.view', 'workflow.edit', 'workflow.delete',
  'workflow.assign', 'workflow.test', 'workflow.migrate',
  'system.configure', 'system.view_logs', 'system.backup', 'system.integrate',
  'system.api_keys', 'system.notification', 'system.maintenance',
  'category.create', 'category.view', 'category.edit', 'category.delete',
  'project.create', 'project.view', 'project.view.all', 'project.edit', 'project.delete',
  'policy.view', 'policy.create', 'policy.edit', 'policy.delete', 'policy.check',
  'form.view', 'form.manage', 'form.publish',
  // Inspection/export, not evidence archival or compliance certification.
  'audit.view', 'audit.view.all', 'audit.export', 'audit.analyze', 'compliance.view',
  'analytics.view', 'analytics.view.sensitive', 'analytics.export', 'analytics.create',
  // AI inspection and template configuration, not budget/anomaly business mutation.
  'llm.query', 'llm.query.all', 'llm.insights.view', 'llm.anomaly.view',
  'llm.history.view', 'llm.history.view.all', 'llm.semantic_search',
  'llm.trends.view', 'llm.trends.view.all', 'llm.forecast', 'llm.budget.view',
  'llm.policy.check', 'llm.project.query', 'llm.project.query.all',
  'llm.template.view', 'llm.template.create', 'llm.template.edit', 'llm.template.delete',
];
