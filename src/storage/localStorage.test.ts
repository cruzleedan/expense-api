import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStorageProvider } from './localStorage.js';
import { ValidationError } from '../types/index.js';

const testRoot = await mkdtemp(join(tmpdir(), 'expense-storage-test-'));
const baseDir = join(testRoot, 'uploads');
const outsideDir = join(testRoot, 'outside');
await mkdir(outsideDir, { recursive: true });
await writeFile(join(outsideDir, 'secret.txt'), 'do not expose');

after(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test('local storage supports files generated below its base directory', async () => {
  const storage = new LocalStorageProvider(baseDir);
  const key = await storage.save(Buffer.from('safe'), 'receipt.txt');

  assert.equal(await storage.exists(key), true);
  assert.equal((await storage.get(key)).toString(), 'safe');
  await storage.delete(key);
  assert.equal(await storage.exists(key), false);
});

test('local storage rejects traversal, absolute paths, and sibling prefixes', async () => {
  const storage = new LocalStorageProvider(baseDir);
  const outsideFile = join(outsideDir, 'secret.txt');
  const paths = ['../outside/secret.txt', outsideFile, '../uploads-sibling/secret.txt'];

  for (const path of paths) {
    await assert.rejects(storage.get(path), ValidationError);
    await assert.rejects(storage.exists(path), ValidationError);
    await assert.rejects(storage.delete(path), ValidationError);
  }

  assert.equal((await readFile(outsideFile)).toString(), 'do not expose');
});

test('local storage rejects symlinks that escape its base directory', async () => {
  const storage = new LocalStorageProvider(baseDir);
  await mkdir(baseDir, { recursive: true });
  await symlink(outsideDir, join(baseDir, 'escape'));

  await assert.rejects(storage.get('escape/secret.txt'), ValidationError);
  await assert.rejects(storage.exists('escape/secret.txt'), ValidationError);
  await assert.rejects(storage.delete('escape/secret.txt'), ValidationError);
  assert.equal((await readFile(join(outsideDir, 'secret.txt'))).toString(), 'do not expose');
});
