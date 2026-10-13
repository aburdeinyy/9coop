import { describe, expect, it } from 'vitest';
import { normalizePickedFolderPath } from '../bridge/src/git-workspace';

describe('normalizePickedFolderPath', () => {
  it('trim и убирает trailing slash (кроме корня)', () => {
    expect(normalizePickedFolderPath('  /Users/dev/proj/  ')).toBe('/Users/dev/proj');
    expect(normalizePickedFolderPath('/')).toBe('/');
  });

  it('пустая строка → null', () => {
    expect(normalizePickedFolderPath('')).toBeNull();
    expect(normalizePickedFolderPath('   ')).toBeNull();
  });
});
