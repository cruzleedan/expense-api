import test from 'node:test';
import assert from 'node:assert/strict';
import { canReceiveNormalTokens } from './accountAccess.js';

test('only active, verified accounts are eligible for normal tokens', () => {
  assert.equal(canReceiveNormalTokens({ is_active: true, is_verified: true }), true);
  assert.equal(canReceiveNormalTokens({ is_active: true, is_verified: false }), false);
  assert.equal(canReceiveNormalTokens({ is_active: false, is_verified: true }), false);
  assert.equal(canReceiveNormalTokens({ is_active: false, is_verified: false }), false);
  assert.equal(canReceiveNormalTokens(null), false);
});
