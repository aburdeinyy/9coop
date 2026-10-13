import { describe, expect, it } from 'vitest';
import { msUntilNextRefresh, formatCountdown } from '../src/app/core/utils/auto-refresh';

describe('msUntilNextRefresh', () => {
  it('считает остаток до следующего тика', () => {
    expect(msUntilNextRefresh(1000, 5000, 3000)).toBe(3000);
    expect(msUntilNextRefresh(1000, 5000, 7000)).toBe(0);
    expect(msUntilNextRefresh(0, 5000, 100)).toBe(0);
  });

  it('formatCountdown', () => {
    expect(formatCountdown(0)).toBe('сейчас');
    expect(formatCountdown(1500)).toBe('2с');
    expect(formatCountdown(65_000)).toBe('1м 5с');
  });
});
