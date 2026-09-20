import { ValidationError } from '../types/index.js';

/** Existing public creation policy, now shared by every credential-creation path. */
export function validatePasswordStrength(password: string, email?: string, username?: string): void {
  if (password.length < 12 || password.length > 128
    || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)
    || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    throw new ValidationError('Password must be 12–128 characters with lowercase, uppercase, number, and special character');
  }
  for (const identity of [email?.split('@')[0], username]) {
    if (identity && password.toLowerCase().includes(identity.toLowerCase())) {
      throw new ValidationError('Password cannot contain your email address or username');
    }
  }
}
