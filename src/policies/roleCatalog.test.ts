import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ADMIN_PERMISSION_NAMES } from './roleCatalog.js';
import { evaluateSodPermissions } from './rbac.js';

test('administrator allowlist excludes financial execution and reserved capabilities', () => {
  assert.equal(new Set(ADMIN_PERMISSION_NAMES).size, ADMIN_PERMISSION_NAMES.length);
  for (const forbidden of [
    'report.create', 'report.edit.all', 'report.approve', 'report.reject', 'report.return',
    'report.correct', 'report.post', 'report.pay', 'report.unpost', 'report.export.financial',
    'role.assign.admin', 'role.assign.finance', 'user.delete', 'user.impersonate',
    'system.restore', 'workflow.override', 'audit.archive', 'compliance.certify',
    'llm.budget.manage', 'llm.anomaly.review',
  ]) {
    assert.equal(ADMIN_PERMISSION_NAMES.includes(forbidden), false, forbidden);
  }
  assert.ok(ADMIN_PERMISSION_NAMES.includes('user.edit'));
  assert.ok(ADMIN_PERMISSION_NAMES.includes('role.assign'));
  assert.ok(ADMIN_PERMISSION_NAMES.includes('form.publish'));
});

test('administrator bootstrap grants exactly match the migration catalog and active seed SoD', async () => {
  const schema = await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');
  const adminGrant = schema.match(/WHERE r\.name = 'admin' AND p\.name IN \(([\s\S]*?)\)\s*ON CONFLICT DO NOTHING;/);
  assert.ok(adminGrant, 'administrator seed must use an explicit allowlist');
  const permissionNames = [...adminGrant[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(permissionNames.sort(), [...ADMIN_PERMISSION_NAMES].sort());

  const sodSeed = schema.slice(schema.indexOf('INSERT INTO sod_rules'));
  const rules = [...sodSeed.matchAll(/ARRAY\[([^\]]+)\], 'critical'/g)].map((match, index) => ({
    name: `seed-rule-${index}`,
    description: null,
    permissionSet: [...match[1].matchAll(/'([^']+)'/g)].map((permission) => permission[1]),
  }));
  assert.equal(rules.length, 6);
  assert.deepEqual(evaluateSodPermissions(ADMIN_PERMISSION_NAMES, rules), []);
});
