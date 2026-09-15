import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const contextRoot = path.resolve('context');
const agentsGuide = await readFile('AGENTS.md', 'utf8');
const failures = [];
const allowedStatuses = new Set([
  'proposed', 'accepted', 'building', 'shipped', 'operating',
  'superseded', 'rejected', 'abandoned',
]);
const allowedIdeaStatuses = new Set(['exploring', 'incubating', 'promoted', 'parked', 'rejected']);
const allowedEntries = new Set([
  'README.md', 'RELEASING.md', 'friction.md', 'work', 'ideas',
  'reviews', 'reference', 'skills', 'agents',
]);

function frontmatter(source) {
  if (!source.startsWith('---\n')) return new Map();
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) return new Map();
  const values = new Map();
  for (const line of source.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"|"$/g, '');
    values.set(key, value);
  }
  return values;
}

async function markdownFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

for (const entry of await readdir(contextRoot)) {
  if (!allowedEntries.has(entry)) failures.push(`context/${entry}: unexpected context entry`);
}

for (const name of await markdownFiles(path.join(contextRoot, 'work'))) {
  if (name === '0000-template.md') continue;
  const source = await readFile(path.join(contextRoot, 'work', name), 'utf8');
  const meta = frontmatter(source);
  const filenameId = name.match(/^(\d{4})-/)?.[1];
  for (const field of ['id', 'title', 'status', 'kind']) {
    if (!meta.get(field)) failures.push(`context/work/${name}: missing ${field} frontmatter`);
  }
  if (filenameId !== meta.get('id')) failures.push(`context/work/${name}: filename/id mismatch`);
  if (!allowedStatuses.has(meta.get('status'))) failures.push(`context/work/${name}: invalid status`);
  if (!source.includes('## Log')) failures.push(`context/work/${name}: missing append-only Log section`);
}

for (const name of await markdownFiles(path.join(contextRoot, 'ideas'))) {
  if (name === '0000-template.md') continue;
  const source = await readFile(path.join(contextRoot, 'ideas', name), 'utf8');
  const meta = frontmatter(source);
  const filenameId = name.match(/^(\d{4})-/)?.[1];
  if (meta.get('id') !== `IDEA-${filenameId}`) failures.push(`context/ideas/${name}: filename/id mismatch`);
  if (!allowedIdeaStatuses.has(meta.get('status'))) failures.push(`context/ideas/${name}: invalid status`);
}

for (const name of await markdownFiles(path.join(contextRoot, 'reference'))) {
  const source = await readFile(path.join(contextRoot, 'reference', name), 'utf8');
  const meta = frontmatter(source);
  if (!meta.get('title') || !/^\d{4}-\d{2}-\d{2}$/.test(meta.get('updated') ?? '')) {
    failures.push(`context/reference/${name}: title and YYYY-MM-DD updated frontmatter are required`);
  }
  if (/^\d{4}-/.test(name)) failures.push(`context/reference/${name}: reference files are not numbered`);
}

for (const kind of ['skills', 'agents']) {
  for (const name of await markdownFiles(path.join(contextRoot, kind))) {
    const source = await readFile(path.join(contextRoot, kind, name), 'utf8');
    const meta = frontmatter(source);
    for (const field of ['name', 'description', 'applies-to']) {
      if (!meta.get(field)) failures.push(`context/${kind}/${name}: missing ${field} frontmatter`);
    }
    if (kind === 'agents' && !meta.get('tools')) failures.push(`context/${kind}/${name}: missing tools frontmatter`);
    if (!agentsGuide.includes(name)) failures.push(`context/${kind}/${name}: not referenced by AGENTS.md`);
  }
}

for (const name of await markdownFiles(path.join(contextRoot, 'reviews'))) {
  if (!(await stat(path.join(contextRoot, 'reviews', name))).isFile()) {
    failures.push(`context/reviews/${name}: expected a regular file`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}

process.stdout.write('verify-context: OK\n');
