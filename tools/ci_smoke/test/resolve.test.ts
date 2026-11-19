import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { resolveFile } from '../src/resolve.js';

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ci_smoke-'));
  mkdirSync(join(root, 'e2e/page'), { recursive: true });
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'e2e/page/index.html'), '<!doctype html>');
  writeFileSync(join(root, 'dist/a.js'), '');
  writeFileSync(join(root, 'package.json'), '{}');
});

test('the static server serves only the page and the dist tree', () => {
  expect(resolveFile(root, '/')).toBe(join(root, 'e2e/page/index.html'));
  expect(resolveFile(root, '/dist/a.js')).toBe(join(root, 'dist/a.js'));
  expect(resolveFile(root, '/package.json')).toBeUndefined();
  expect(resolveFile(root, '/dist/missing.js')).toBeUndefined();
  expect(resolveFile(root, '/dist/')).toBeUndefined();
});

test('the static server resolves no file for a path that climbs out of the served trees', () => {
  expect(resolveFile(root, '/dist/../package.json')).toBeUndefined();
  expect(resolveFile(root, '/dist/%2e%2e/package.json')).toBeUndefined();
  expect(resolveFile(root, '/dist/../../etc/passwd')).toBeUndefined();
  expect(resolveFile(root, '/dist/%zz')).toBeUndefined();
});
