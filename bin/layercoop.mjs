#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = path.join(root, 'cli', 'main.ts');

function resolveTsxLoader(packageRoot) {
  const nested = path.join(packageRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  if (fs.existsSync(nested)) return nested;
  try {
    const require = createRequire(path.join(packageRoot, 'package.json'));
    const pkgJson = require.resolve('tsx/package.json');
    const loader = path.join(path.dirname(pkgJson), 'dist', 'loader.mjs');
    if (fs.existsSync(loader)) return loader;
  } catch {
    /* fallthrough */
  }
  return null;
}

const tsxLoader = resolveTsxLoader(root);
if (!tsxLoader) {
  console.error(
    `Не найден tsx loader рядом с ${root}. Переустанови пакет (npm i -g layercoop / npx layercoop).`,
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  ['--import', tsxLoader, main, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  },
);
process.exit(result.status ?? 1);
