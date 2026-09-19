import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const match = /^([0-9a-f]{32}):([0-9a-f]{128})$/i.exec(hash);
  if (!match) return false;
  const key = await derive(password, match[1], 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}
