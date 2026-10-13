import fs from 'node:fs';
import path from 'node:path';
import { LAYERCOOP_DIR } from '../../src/app/core/utils/layercoop-architecture';

export type DeleteArtifactsResult = {
  deleted: string[];
  missing: string[];
};

function normalizeRel(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** Только пути внутри `.layercoop/` (файл или каталог). */
export function assertSafeLayercoopRel(rel: string): string {
  const n = normalizeRel(rel);
  if (!n || n.includes('\0') || n.includes('..') || path.isAbsolute(n)) {
    throw new Error(`Небезопасный путь: ${rel}`);
  }
  if (n !== LAYERCOOP_DIR && !n.startsWith(`${LAYERCOOP_DIR}/`)) {
    throw new Error(`Разрешено удалять только под ${LAYERCOOP_DIR}/`);
  }
  return n;
}

export function resolveUnderCwd(cwd: string, rel: string): string {
  const safe = assertSafeLayercoopRel(rel);
  const root = path.resolve(cwd);
  const abs = path.resolve(root, safe);
  const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootSep)) {
    throw new Error('Путь вне cwd');
  }
  return abs;
}

export function deleteLayercoopArtifacts(
  cwd: string,
  paths: string[],
): DeleteArtifactsResult {
  const root = path.resolve(cwd?.trim() || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`cwd не существует: ${root}`);
  }

  const deleted: string[] = [];
  const missing: string[] = [];
  const unique = [...new Set(paths.map(normalizeRel).filter(Boolean))];
  // Сначала файлы, потом каталоги — или наоборот: длинные пути первыми
  unique.sort((a, b) => b.length - a.length);

  for (const rel of unique) {
    const abs = resolveUnderCwd(root, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    fs.rmSync(abs, { recursive: true, force: true });
    deleted.push(rel);
  }

  return { deleted, missing };
}
