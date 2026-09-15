import { ForbiddenError } from '../types/index.js';

export interface UserAdministrationActor {
  id: string;
  permissions: string[];
}

export interface UserProfileUpdate {
  username?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  llmPreferences?: unknown;
  email?: unknown;
  isActive?: unknown;
  departmentId?: unknown;
  managerId?: unknown;
  costCenter?: unknown;
  spendingProfile?: unknown;
}

export function assertCanViewUser(
  actor: UserAdministrationActor,
  targetUserId: string
): void {
  if (actor.id === targetUserId && actor.permissions.includes('user.edit.own')) return;
  if (
    actor.permissions.includes('user.view') &&
    actor.permissions.includes('role.view')
  ) {
    return;
  }
  throw new ForbiddenError('Viewing another user requires user.view and role.view');
}

export function assertCanUpdateUser(
  actor: UserAdministrationActor,
  targetUserId: string,
  input: UserProfileUpdate
): void {
  if (actor.permissions.includes('user.edit')) return;
  if (actor.id !== targetUserId || !actor.permissions.includes('user.edit.own')) {
    throw new ForbiddenError('user.edit.own is limited to the current user');
  }

  const adminOnlyFields = [
    input.email,
    input.isActive,
    input.departmentId,
    input.managerId,
    input.costCenter,
    input.spendingProfile,
  ];
  if (adminOnlyFields.some((value) => value !== undefined)) {
    throw new ForbiddenError('Administrative account fields require user.edit');
  }
}

export function assertNotSelfRoleMutation(
  actor: UserAdministrationActor,
  targetUserId: string
): void {
  if (actor.id === targetUserId) {
    throw new ForbiddenError('Users cannot change their own roles');
  }
}
