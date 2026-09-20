import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = process.cwd();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const lock = readJson(resolve(root, 'package-lock.json'));
const bom = readJson(resolve(root, 'sbom.cdx.json'));
assert.equal(bom.bomFormat, 'CycloneDX');
const installed = new Set();
for (const location of Object.keys(lock.packages)) {
  if (!location.startsWith('node_modules/')) continue;
  const directory = resolve(root, location);
  assert.ok(directory.startsWith(`${resolve(root, 'node_modules')}${sep}`), 'invalid lockfile package path');
  const manifest = resolve(directory, 'package.json');
  if (!existsSync(manifest)) continue;
  const pkg = readJson(manifest);
  installed.add(`${pkg.name}@${pkg.version}`);
}
const inventory = new Set(bom.components.map((component) =>
  `${component.group ? `${component.group}/` : ''}${component.name}@${component.version}`
));
assert.ok(inventory.size > 0, 'empty SBOM');
assert.deepEqual(inventory, installed, 'SBOM must exactly match the pruned production dependency inventory');
for (const name of ['sharp', 'drizzle-kit', '@apidevtools/swagger-parser', 'typescript', 'tsx']) {
  assert.ok(![...inventory].some((id) => id.startsWith(`${name}@`)), `unexpected production component: ${name}`);
}
process.stdout.write(`verify-sbom: OK (CycloneDX ${bom.specVersion}; ${inventory.size} actual production dependencies)\n`);
