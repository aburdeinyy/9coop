import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
} from '../src/app/core/utils/sidebar-width';

describe('clampSidebarWidth', () => {
  it('не даёт стать уже минимума', () => {
    expect(clampSidebarWidth(100, 1440)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('не даёт перекрыть canvas: максимум viewport − 320', () => {
    expect(clampSidebarWidth(2000, 1000)).toBe(680);
  });

  it('округлённо принимает ширину в допустимом диапазоне', () => {
    expect(clampSidebarWidth(401.6, 1440)).toBe(402);
  });

  it('дефолт в диапазоне', () => {
    expect(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, 1440)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
