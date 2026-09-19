import { transaction } from '../db/client.js';
import { UnauthorizedError, ConflictError, type JwtPayloadV3 } from '../types/index.js';
import { lockSessionUser, assertSessionAccount } from './session.service.js';
import { verifyPassword } from '../utils/password.js';
import { logAuditEvent } from './audit.service.js';
import { AUTH_VERSION } from '../policies/session.js';

/** Only called after provider verification. Subject/email fields are not accepted from HTTP clients. */
export async function linkProviderIdentity(
  actor: JwtPayloadV3, provider: 'google' | 'facebook', verifiedSubject: string, password: string
): Promise<{ provider: 'google' | 'facebook'; linked: boolean }> {
  return transaction(async client => {
    const user = await lockSessionUser(client, actor.sub);
    assertSessionAccount(user);
    if (user.roles_version !== actor.roles_version) throw new UnauthorizedError('Session invalidated due to permission changes');
    const session = await client.query(
      `SELECT id FROM refresh_tokens WHERE id = $1 AND user_id = $2
       AND revoked_at IS NULL AND expires_at > clock_timestamp() AND auth_version = $3 FOR UPDATE`,
      [actor.refresh_token_id, user.id, AUTH_VERSION]);
    if (!session.rowCount || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedError('An active session and current account password are required to link an identity');
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO user_identities(user_id, provider, subject) VALUES ($1,$2,$3)
       ON CONFLICT(provider, subject) DO NOTHING RETURNING id`, [user.id, provider, verifiedSubject]);
    if (!inserted.rows[0]) {
      const owner = await client.query<{ user_id: string }>(
        'SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2', [provider, verifiedSubject]);
      if (owner.rows[0]?.user_id !== user.id) throw new ConflictError('Provider identity is already linked to another account');
      return { provider, linked: true };
    }
    await logAuditEvent({
      actorId: user.id, actorEmail: user.email, sessionId: actor.refresh_token_id,
      action: 'authentication.identity_linked', actionCategory: 'authentication',
      resourceType: 'identity', resourceId: inserted.rows[0].id,
      metadata: { provider, account_proof: 'current_password', work_item: 'WORK-0030' }, client,
    });
    return { provider, linked: true };
  });
}
