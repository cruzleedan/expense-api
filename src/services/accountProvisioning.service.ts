import type { PoolClient } from 'pg';
import { ValidationError } from '../types/index.js';

/** Account creation and its required initial role are one transaction. */
export async function assignDefaultRole(client: PoolClient, userId: string): Promise<void> {
  const role = await client.query<{ id: string }>(
    "SELECT id FROM roles WHERE name = 'employee' AND is_active FOR SHARE");
  if (!role.rows[0]) throw new ValidationError('Active default employee role is unavailable');
  await client.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1,$2)', [userId, role.rows[0].id]);
}
export function isDuplicateEmail(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === '23505' && pgError.constraint === 'users_email_key';
}
