import { describe, expect, it } from 'vitest';
import { nodeAuraBox } from '../src/app/core/utils/node-aura';

describe('nodeAuraBox', () => {
  it('центрирует ауру под нодой и увеличивает размер', () => {
    const box = nodeAuraBox({ x: 100, y: 50 }, { w: 120, h: 80 }, { x: 0, y: 0 }, 1, 1);
    expect(box.width).toBe(240);
    expect(box.height).toBe(160);
    expect(box.left).toBe(40);
    expect(box.top).toBe(10);
  });

  it('следует за pan и zoom как нода', () => {
    const box = nodeAuraBox({ x: 100, y: 50 }, { w: 100, h: 100 }, { x: 20, y: 10 }, 2, 1);
    expect(box.left).toBe((100 - 50) * 2 + 20);
    expect(box.top).toBe((50 - 50) * 2 + 10);
    expect(box.width).toBe(200);
  });
});
