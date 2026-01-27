import { createHash } from 'crypto';

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

export function generateSalt(): string {
  return createHash('sha256').update(Math.random().toString() + Date.now().toString()).digest('hex').substring(0, 16);
}
