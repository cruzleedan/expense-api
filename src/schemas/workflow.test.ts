import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateWorkflowRequestSchema } from './workflow.js';

const base = {
  name: 'Expense approval',
  steps: [{
    stepNumber: 1,
    name: 'Manager',
    targetType: 'relationship' as const,
    targetValue: 'direct_manager',
    slaHours: 24,
  }],
};

test('workflow definitions validate target-value semantics', () => {
  assert.equal(CreateWorkflowRequestSchema.safeParse(base).success, true);
  assert.equal(CreateWorkflowRequestSchema.safeParse({
    ...base,
    steps: [{ ...base.steps[0], targetValue: 'unknown_relationship' }],
  }).success, false);
  assert.equal(CreateWorkflowRequestSchema.safeParse({
    ...base,
    steps: [{ ...base.steps[0], targetType: 'hybrid', targetValue: 'finance' }],
  }).success, false);
});

test('workflow definitions reject duplicate step numbers', () => {
  assert.equal(CreateWorkflowRequestSchema.safeParse({
    ...base,
    steps: [base.steps[0], { ...base.steps[0], name: 'Duplicate' }],
  }).success, false);
});
