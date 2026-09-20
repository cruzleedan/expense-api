import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertControlPlaneAdminRemains,
  assertSodCompliant,
  evaluateSodPermissions,
  hasValidPrivilegeClaimsVersion,
  isStepUpFresh,
} from './rbac.js';
import { ConflictError, ValidationError } from '../types/index.js';

const rules = [
  {
    name: 'approve-and-pay',
    description: 'Approval and payment must be separate',
    permissionSet: ['report.approve', 'report.pay'],
  },
];

test('SoD evaluates the exact supplied final permission set', () => {
  assert.deepEqual(evaluateSodPermissions(['report.approve'], rules), []);
  assert.equal(
    evaluateSodPermissions(['report.approve', 'report.pay'], rules)[0].ruleName,
    'approve-and-pay'
  );
  assert.throws(
    () => assertSodCompliant(['report.approve', 'report.pay'], rules, 'user 123'),
    ValidationError
  );
});

test('privilege-bearing tokens cannot skip role-version invalidation', () => {
  assert.equal(hasValidPrivilegeClaimsVersion({}), false);
  assert.equal(hasValidPrivilegeClaimsVersion({ permissions: ['role.edit'] }), false);
  assert.equal(hasValidPrivilegeClaimsVersion({ roles: ['admin'], roles_version: 0 }), false);
  assert.equal(hasValidPrivilegeClaimsVersion({ permissions: [], roles_version: 1 }), true);
});

test('step-up freshness rejects missing, future, and expired evidence', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  assert.equal(isStepUpFresh(null, now, 300), false);
  assert.equal(isStepUpFresh(new Date('2026-09-15T11:55:00.000Z'), now, 300), true);
  assert.equal(isStepUpFresh(new Date('2026-09-15T11:54:59.999Z'), now, 300), false);
  assert.equal(isStepUpFresh(new Date('2026-09-15T12:00:00.001Z'), now, 300), false);
});

test('the final eligible control-plane administrator cannot be removed', () => {
  assert.throws(
    () => assertControlPlaneAdminRemains(1, true, false),
    ConflictError
  );
  assert.doesNotThrow(() => assertControlPlaneAdminRemains(2, true, false));
  assert.doesNotThrow(() => assertControlPlaneAdminRemains(1, true, true));
  assert.doesNotThrow(() => assertControlPlaneAdminRemains(1, false, false));
});
