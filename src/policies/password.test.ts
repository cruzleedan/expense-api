import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordStrength } from './password.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

test('all password creation uses the existing complexity policy and bounded length', () => {
  assert.doesNotThrow(() => validatePasswordStrength('Strong!Pass2026', 'employee@example.test', 'employee'));
  for (const password of ['Short!1', 'lowercaseonly123!', 'UPPERCASEONLY123!', 'NoNumbers!Here', 'NoSymbols123Here', 'x'.repeat(129)]) {
    assert.throws(() => validatePasswordStrength(password));
  }
  assert.throws(() => validatePasswordStrength('Employee!2026Strong', 'employee@example.test'));
  assert.throws(() => validatePasswordStrength('Username!2026Strong', undefined, 'username'));
});
test('scrypt hashes remain compatible and malformed hashes fail authentication, not 500', async () => {
  const hash = await hashPassword('historically-weak');
  assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(await verifyPassword('historically-weak', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  for (const bad of ['', 'salt:key', 'a'.repeat(32) + ':', hash + ':extra']) {
    assert.equal(await verifyPassword('password', bad), false);
  }
});
