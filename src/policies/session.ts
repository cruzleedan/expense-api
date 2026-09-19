/** WORK-0030 is an explicit cutover: pre-family tokens are never accepted. */
export const AUTH_VERSION = 2;
export const MAX_SESSION_FAMILIES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
export function durationSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = match ? Number(match[1]) * units[match[2]] : NaN;
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 2147483647) {
    throw new Error('JWT duration must be a positive, bounded number of seconds, minutes, hours, or days');
  }
  return seconds;
}
