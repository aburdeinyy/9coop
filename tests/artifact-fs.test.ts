import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSafeLayercoopRel,
  deleteLayercoopArtifacts,
} from '../bridge/src/artifact-fs';

const dirs: string[] = [];

function tmpCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layercoop-fs-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('artifact-fs', () => {
  it('reject path traversal / вне .layercoop', () => {
    expect(() => assertSafeLayercoopRel('../etc/passwd')).toThrow();
    expect(() => assertSafeLayercoopRel('src/app.ts')).toThrow();
    expect(assertSafeLayercoopRel('.layercoop/skills/x/SKILL.md')).toBe(
      '.layercoop/skills/x/SKILL.md',
    );
  });

  it('удаляет skill-каталог под cwd', () => {
    const cwd = tmpCwd();
    const skillDir = path.join(cwd, '.layercoop', 'skills', 'ponytail');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# hi');
    fs.writeFileSync(path.join(cwd, 'keep.txt'), 'ok');

    const result = deleteLayercoopArtifacts(cwd, [
      '.layercoop/skills/ponytail/SKILL.md',
      '.layercoop/skills/ponytail',
    ]);
    expect(result.deleted).toContain('.layercoop/skills/ponytail');
    expect(fs.existsSync(skillDir)).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'keep.txt'))).toBe(true);
  });
});
