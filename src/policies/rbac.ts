import { ConflictError, ValidationError } from '../types/index.js';

export interface SodPolicyRule {
  name: string;
  description: string | null;
  permissionSet: readonly string[];
}

export interface SodPolicyViolation {
  ruleName: string;
  description: string;
  conflictingPermissions: string[];
}

export function evaluateSodPermissions(
  permissions: readonly string[],
  rules: readonly SodPolicyRule[]
): SodPolicyViolation[] {
  const effectivePermissions = new Set(permissions);

  return rules
    .filter((rule) => rule.permissionSet.every((permission) => effectivePermissions.has(permission)))
    .map((rule) => ({
      ruleName: rule.name,
      description: rule.description ?? '',
      conflictingPermissions: [...rule.permissionSet],
    }));
}

export function assertSodCompliant(
  permissions: readonly string[],
  rules: readonly SodPolicyRule[],
  subject: string
): void {
  const violations = evaluateSodPermissions(permissions, rules);
  if (violations.length === 0) return;

  throw new ValidationError(`Separation of duties violation for ${subject}`, { violations });
}

export function isStepUpFresh(
  verifiedAt: Date | null | undefined,
  now: Date,
  ttlSeconds: number
): boolean {
  if (!verifiedAt || ttlSeconds <= 0) return false;
  const ageMs = now.getTime() - verifiedAt.getTime();
  return ageMs >= 0 && ageMs <= ttlSeconds * 1000;
}

/** Pure legacy identity tokens may remain supported, but privilege claims must be versioned. */
export function hasValidPrivilegeClaimsVersion(payload: {
  roles?: unknown;
  permissions?: unknown;
  roles_version?: unknown;
}): boolean {
  if (payload.roles === undefined && payload.permissions === undefined) return true;
  return typeof payload.roles_version === 'number'
    && Number.isInteger(payload.roles_version)
    && payload.roles_version > 0;
}

export function assertControlPlaneAdminRemains(
  activeAdminCount: number,
  targetHasControlPlaneRole: boolean,
  targetWillRemainEligible: boolean
): void {
  if (targetHasControlPlaneRole && !targetWillRemainEligible && activeAdminCount <= 1) {
    throw new ConflictError('Cannot remove the final active verified super administrator');
  }
}
