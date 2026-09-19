import { ValidationError } from '../types/index.js';

export function googleIdentity(payload: {
  sub?: unknown; email?: unknown; email_verified?: unknown; aud?: unknown; azp?: unknown;
}, allowedAudiences: readonly string[]): { id: string; email: string } {
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 255
    || typeof payload.email !== 'string' || !payload.email.includes('@') || payload.email_verified !== true
    || !audiences.some(aud => typeof aud === 'string' && allowedAudiences.includes(aud))
    || (audiences.length > 1 && typeof payload.azp !== 'string')
    || (payload.azp !== undefined && (typeof payload.azp !== 'string' || !allowedAudiences.includes(payload.azp)))) {
    throw new ValidationError('Google identity must have a verified email and approved audience/presenter');
  }
  return { id: payload.sub, email: payload.email };
}

export function facebookIdentity(
  data: { is_valid?: unknown; app_id?: unknown; user_id?: unknown; expires_at?: unknown; data_access_expires_at?: unknown } | undefined,
  profile: { id?: unknown; email?: unknown }, appId: string, nowSeconds = Math.floor(Date.now() / 1000)
): { id: string; email: string } {
  if (!data || data.is_valid !== true || data.app_id !== appId
    || typeof data.user_id !== 'string' || !data.user_id.trim() || data.user_id.length > 255
    || profile.id !== data.user_id || typeof data.expires_at !== 'number' || data.expires_at <= nowSeconds
    || (data.data_access_expires_at !== undefined && (typeof data.data_access_expires_at !== 'number'
      || (data.data_access_expires_at !== 0 && data.data_access_expires_at <= nowSeconds)))) {
    throw new ValidationError('Invalid Facebook app, subject, or token expiry');
  }
  // Facebook email presence is NOT verification. It is never used for lookup,
  // account creation, linking, or replacing the provisioned local email.
  return { id: data.user_id, email: typeof profile.email === 'string' ? profile.email : '' };
}
