import { describe, expect, it } from 'vitest';
import {
  parseGitStatusPorcelain,
  resolveSafeRepoPath,
  resolveSafeFileInRepo,
} from '../bridge/src/git-workspace';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('parseGitStatusPorcelain', () => {
  it('парсит branch и файлы', () => {
    const out = [
      '## main...origin/main',
      ' M src/a.ts',
      '?? new.txt',
      'D  gone.md',
    ].join('\n');
    const parsed = parseGitStatusPorcelain(out);
    expect(parsed.branch).toBe('main');
    expect(parsed.files).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'new.txt', status: '?' },
      { path: 'gone.md', status: 'D' },
    ]);
    expect(parsed.totals.changed).toBe(3);
  });

  it('пустой статус', () => {
    expect(parseGitStatusPorcelain('## develop\n')).toEqual({
      branch: 'develop',
      files: [],
      totals: { changed: 0 },
    });
  });
});

describe('resolveSafeRepoPath / resolveSafeFileInRepo', () => {
  it('принимает существующий абсолютный путь', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-repo-'));
    expect(resolveSafeRepoPath(dir)).toBe(fs.realpathSync(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('отклоняет относительный и escape', () => {
    expect(() => resolveSafeRepoPath('relative/path')).toThrow(/абсолют/i);
    expect(() => resolveSafeRepoPath('/no/such/dir-xyz-layercoop')).toThrow();
  });

  it('file не выходит за repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-repo-'));
    fs.writeFileSync(path.join(dir, 'ok.ts'), 'x');
    const root = fs.realpathSync(dir);
    expect(resolveSafeFileInRepo(root, 'ok.ts')).toBe(path.join(root, 'ok.ts'));
    expect(() => resolveSafeFileInRepo(root, '../outside')).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
