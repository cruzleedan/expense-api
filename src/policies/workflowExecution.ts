import type { WorkflowStep, WorkflowStepCondition } from '../types/index.js';
import { ForbiddenError, ValidationError } from '../types/index.js';

export type FrozenWorkflowStep = WorkflowStep & { eligible_user_ids: string[] };
export type WorkflowEvaluationContext = Record<string, unknown>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Combine resolved principals using the documented semantics for each target type. */
export function combineEligiblePrincipals(
  targetType: WorkflowStep['target_type'],
  rolePrincipals: readonly string[],
  relationshipPrincipals: readonly string[]
): string[] {
  const roles = unique(rolePrincipals);
  const relationships = new Set(relationshipPrincipals);

  switch (targetType) {
    case 'role':
      return roles;
    case 'relationship':
      return unique(relationshipPrincipals);
    case 'hybrid':
      return roles.filter((id) => relationships.has(id));
    case 'system':
      return [];
  }
}

export function evaluateWorkflowCondition(
  condition: WorkflowStepCondition,
  context: WorkflowEvaluationContext
): boolean {
  const fieldValue = context[condition.field];

  switch (condition.condition) {
    case 'greater_than':
      return Number(fieldValue) > Number(condition.value);
    case 'less_than':
      return Number(fieldValue) < Number(condition.value);
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
  }
}

export function shouldSkipWorkflowStep(
  step: WorkflowStep,
  context: WorkflowEvaluationContext
): boolean {
  if (step.skip_if && evaluateWorkflowCondition(step.skip_if, context)) {
    return true;
  }
  if (step.required_if) {
    return !evaluateWorkflowCondition(step.required_if, context);
  }
  return step.required === false;
}

/** Find the next required step, advancing across any number of skipped steps. */
export function findNextRequiredStep<T extends WorkflowStep>(
  steps: readonly T[],
  context: WorkflowEvaluationContext,
  afterStep = 0
): T | undefined {
  return [...steps]
    .sort((a, b) => a.step_number - b.step_number)
    .find((step) => step.step_number > afterStep && !shouldSkipWorkflowStep(step, context));
}

/** Deny legacy/unresolved snapshots as well as actors outside the frozen target. */
export function assertActorEligibleForStep(step: WorkflowStep, actorId: string): void {
  if (step.target_type === 'system') {
    throw new ForbiddenError('This workflow step can only be executed by the system');
  }
  if (!Array.isArray(step.eligible_user_ids)) {
    throw new ValidationError('Workflow snapshot has no frozen approver target; resubmit the report');
  }
  if (!step.eligible_user_ids.includes(actorId)) {
    throw new ForbiddenError('You are not an eligible approver for the current workflow step');
  }
}
