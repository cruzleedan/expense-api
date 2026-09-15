import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_TRANSITIONS,
  assertAccountingSeparationOfDuties,
  assertExpectedVersion,
  assertReportTransition,
} from './reportLifecycle.js';
import { ConflictError, ForbiddenError } from '../types/index.js';

test('report lifecycle matrix allows only documented source states', () => {
  for (const [action, transition] of Object.entries(REPORT_TRANSITIONS)) {
    for (const source of transition.sources) {
      assert.doesNotThrow(() => assertReportTransition(action as keyof typeof REPORT_TRANSITIONS, source));
    }
  }

  assert.throws(() => assertReportTransition('edit', 'approved'), ConflictError);
  assert.throws(() => assertReportTransition('post', 'draft'), ConflictError);
  assert.throws(() => assertReportTransition('pay', 'approved'), ConflictError);
});

test('stale and concurrent commands fail optimistic concurrency', () => {
  assert.doesNotThrow(() => assertExpectedVersion(7, 7));
  assert.throws(() => assertExpectedVersion(8, 7), ConflictError);
});

test('accounting commands enforce submitter/poster/payer separation', () => {
  assert.throws(
    () => assertAccountingSeparationOfDuties({ actorId: 'submitter', submitterId: 'submitter', action: 'post' }),
    ForbiddenError
  );
  assert.throws(
    () => assertAccountingSeparationOfDuties({ actorId: 'poster', submitterId: 'submitter', postedBy: 'poster', action: 'pay' }),
    ForbiddenError
  );
  assert.doesNotThrow(() =>
    assertAccountingSeparationOfDuties({ actorId: 'payer', submitterId: 'submitter', postedBy: 'poster', action: 'pay' })
  );
});
