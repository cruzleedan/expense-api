import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateExpenseReportSchema } from './expenseReport.js';
import { PayReportRequestSchema, PostReportRequestSchema } from './workflow.js';

test('generic report update accepts versioned descriptive edits', () => {
  const result = UpdateExpenseReportSchema.safeParse({
    expectedVersion: 4,
    title: 'Updated title',
    description: null,
    tags: ['travel'],
  });
  assert.equal(result.success, true);
});

test('generic report update rejects lifecycle and derived financial bypass fields', () => {
  for (const forbidden of [
    { status: 'paid' },
    { totalAmount: 0 },
    { netAmount: 0 },
    { paidBy: 'attacker' },
    { paidAt: new Date().toISOString() },
    { rejectionReason: 'bypass' },
    { baseCurrencyTotal: 0 },
  ]) {
    const result = UpdateExpenseReportSchema.safeParse({ expectedVersion: 1, ...forbidden });
    assert.equal(result.success, false);
  }
});

test('posting and payment commands require version and accounting references', () => {
  assert.equal(PostReportRequestSchema.safeParse({ expectedVersion: 2, postingReference: 'BATCH-42' }).success, true);
  assert.equal(PayReportRequestSchema.safeParse({ expectedVersion: 3, paymentReference: 'PAY-42' }).success, true);
  assert.equal(PostReportRequestSchema.safeParse({ postingReference: 'BATCH-42' }).success, false);
  assert.equal(PayReportRequestSchema.safeParse({ expectedVersion: 3 }).success, false);
});
