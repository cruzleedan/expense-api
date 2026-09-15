import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanUpdateUser,
  assertCanViewUser,
  assertNotSelfRoleMutation,
  type UserAdministrationActor,
} from './userAdministration.js';
import { ForbiddenError } from '../types/index.js';

const employee: UserAdministrationActor = {
  id: 'employee',
  permissions: ['user.edit.own'],
};
const manager: UserAdministrationActor = {
  id: 'manager',
  permissions: ['user.view', 'user.edit.own'],
};
const hrAdmin: UserAdministrationActor = {
  id: 'hr-admin',
  permissions: ['user.view', 'role.view', 'user.edit', 'role.assign'],
};
const superAdmin: UserAdministrationActor = {
  id: 'super-admin',
  permissions: ['user.view', 'role.view', 'user.edit', 'role.assign', 'role.assign.admin'],
};

test('employee scope permits safe self-service fields only', () => {
  assert.doesNotThrow(() => assertCanViewUser(employee, employee.id));
  assert.doesNotThrow(() =>
    assertCanUpdateUser(employee, employee.id, { firstName: 'Updated' })
  );
  assert.throws(
    () => assertCanUpdateUser(employee, employee.id, { managerId: 'manager' }),
    ForbiddenError
  );
  assert.throws(() => assertCanViewUser(employee, manager.id), ForbiddenError);
});

test('manager cannot use profile-view permission as an administrator capability', () => {
  assert.throws(() => assertCanViewUser(manager, employee.id), ForbiddenError);
  assert.throws(
    () => assertCanUpdateUser(manager, employee.id, { firstName: 'Changed' }),
    ForbiddenError
  );
});

test('HR/admin and super-admin capabilities permit scoped administration', () => {
  for (const actor of [hrAdmin, superAdmin]) {
    assert.doesNotThrow(() => assertCanViewUser(actor, employee.id));
    assert.doesNotThrow(() =>
      assertCanUpdateUser(actor, employee.id, { departmentId: 'department' })
    );
  }
});

test('self-role mutation fails closed for every actor including super-admin', () => {
  for (const actor of [employee, manager, hrAdmin, superAdmin]) {
    assert.throws(() => assertNotSelfRoleMutation(actor, actor.id), ForbiddenError);
  }
  assert.doesNotThrow(() => assertNotSelfRoleMutation(hrAdmin, employee.id));
});
