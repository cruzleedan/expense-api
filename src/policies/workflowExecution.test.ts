import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertActorEligibleForStep,
  combineEligiblePrincipals,
  findNextRequiredStep,
  shouldSkipWorkflowStep,
} from './workflowExecution.js';
import type { WorkflowStep } from '../types/index.js';
import { ForbiddenError, ValidationError } from '../types/index.js';

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  step_number: 1,
  name: 'Approval',
  target_type: 'role',
  target_value: 'finance',
  sla_hours: 24,
  required: true,
  ...overrides,
});

test('workflow target types resolve role, relationship, hybrid, and system principals', () => {
  assert.deepEqual(combineEligiblePrincipals('role', ['role-a', 'role-a'], ['manager']), ['role-a']);
  assert.deepEqual(combineEligiblePrincipals('relationship', ['role-a'], ['manager', 'manager']), ['manager']);
  assert.deepEqual(combineEligiblePrincipals('hybrid', ['a', 'b'], ['b', 'c']), ['b']);
  assert.deepEqual(combineEligiblePrincipals('system', ['a'], ['a']), []);
});

test('workflow progression crosses multiple skipped steps without bypassing a later required step', () => {
  const steps = [
    step({ step_number: 1 }),
    step({ step_number: 2, required_if: { field: 'total_amount', condition: 'greater_than', value: 1000 } }),
    step({ step_number: 3, skip_if: { field: 'currency', condition: 'equals', value: 'USD' } }),
    step({ step_number: 4 }),
  ];

  assert.equal(findNextRequiredStep(steps, { total_amount: 500, currency: 'USD' }, 1)?.step_number, 4);
});

test('explicit optional steps are skipped while matching conditional steps remain active', () => {
  assert.equal(shouldSkipWorkflowStep(step({ required: false }), {}), true);
  assert.equal(shouldSkipWorkflowStep(step({
    required_if: { field: 'total_amount', condition: 'greater_than', value: 100 },
  }), { total_amount: 101 }), false);
});

test('only a frozen eligible actor can execute a human workflow step', () => {
  assert.doesNotThrow(() => assertActorEligibleForStep(step({ eligible_user_ids: ['eligible'] }), 'eligible'));
  assert.throws(
    () => assertActorEligibleForStep(step({ eligible_user_ids: ['eligible'] }), 'outsider'),
    ForbiddenError
  );
  assert.throws(() => assertActorEligibleForStep(step(), 'anyone'), ValidationError);
  assert.throws(
    () => assertActorEligibleForStep(step({ target_type: 'system', target_value: 'policy-engine', eligible_user_ids: [] }), 'anyone'),
    ForbiddenError
  );
});

test('return actions cannot bypass the frozen current-step target', () => {
  const currentStep = step({ eligible_user_ids: ['manager'] });
  assert.throws(() => assertActorEligibleForStep(currentStep, 'finance-outsider'), ForbiddenError);
});
