import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
  }
  return files;
}

for (const file of await walk(path.join(root, 'src'))) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(root, file);

  if (/\bexport\s+default\b/.test(source)) {
    failures.push(`${relative}: default exports are not allowed`);
  }

  const localImports = source.matchAll(/(?:\bfrom\s+|\bimport\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g);
  for (const match of localImports) {
    const specifier = match[2];
    if (!specifier.endsWith('.js') && !specifier.endsWith('.json')) {
      failures.push(`${relative}: local import must use a runtime extension: ${specifier}`);
    }
  }

  if (
    relative.startsWith(`src${path.sep}schemas${path.sep}`)
    && source.includes('.openapi(')
    && /from\s+['"]zod['"]/.test(source)
  ) {
    failures.push(`${relative}: OpenAPI schemas must import z from @hono/zod-openapi`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}

process.stdout.write('verify-conventions: OK\n');
