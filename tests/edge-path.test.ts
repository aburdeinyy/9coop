import { describe, expect, it } from 'vitest';
import {
  cubicEdgePath,
  cubicPathBetweenBoxes,
  nearestPortSide,
  nodeBox,
  portAnchor,
} from '../src/app/core/utils/edge-path';
import type { GraphNode } from '../src/app/core/models/graph.model';

function god(x: number, y: number): GraphNode {
  return { id: 'god', type: 'god', position: { x, y }, data: { label: 'Cursor' } };
}

function skill(x: number, y: number): GraphNode {
  return {
    id: 'skill-1',
    type: 'artifact',
    position: { x, y },
    data: { kind: 'skill', label: 'S', prompt: '', connected: true },
  };
}

describe('nodeBox', () => {
  it('даёт размеры GOD и artifact', () => {
    expect(nodeBox(god(10, 20))).toEqual({ x: 10, y: 20, w: 120, h: 80 });
    expect(nodeBox(skill(0, 0))).toEqual({ x: 0, y: 0, w: 160, h: 72 });
  });
});

describe('cubicEdgePath', () => {
  it('при ноде справа крепит к правому и левому ребрам', () => {
    const path = cubicEdgePath(god(0, 100), skill(300, 100));
    // GOD right-center (120, 140) → skill left-center (300, 136)
    expect(path.startsWith('M 120 140')).toBe(true);
    expect(path).toContain('300 136');
    expect(path).toMatch(/C /);
  });

  it('при ноде слева крепит к левому и правому ребрам', () => {
    const path = cubicEdgePath(god(300, 100), skill(0, 100));
    expect(path.startsWith('M 300 140')).toBe(true);
    expect(path).toContain('160 136');
  });

  it('при ноде сверху крепит к верхнему и нижнему ребрам', () => {
    const path = cubicEdgePath(god(100, 300), skill(80, 0));
    // GOD top-center (160, 300) → skill bottom-center (160, 72)
    expect(path.startsWith('M 160 300')).toBe(true);
    expect(path).toContain('160 72');
  });

  it('при ноде снизу крепит к нижнему и верхнему ребрам', () => {
    const path = cubicEdgePath(god(100, 0), skill(80, 300));
    expect(path.startsWith('M 160 80')).toBe(true);
    expect(path).toContain('160 300');
  });
});

describe('fixed port sides', () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const bRight = { x: 300, y: 0, w: 100, h: 40 };
  const bBelow = { x: 0, y: 200, w: 100, h: 40 };

  it('nearestPortSide — ближайшая сторона к точке', () => {
    expect(nearestPortSide(a, -10, 20)).toBe('left');
    expect(nearestPortSide(a, 110, 20)).toBe('right');
    expect(nearestPortSide(a, 50, -5)).toBe('top');
    expect(nearestPortSide(a, 50, 50)).toBe('bottom');
  });

  it('cubicPathBetweenBoxes с fixed sides не прыгает при смене раскладки', () => {
    const fixed = { from: 'top' as const, to: 'bottom' as const };
    const pathBeside = cubicPathBetweenBoxes(a, bRight, fixed);
    const pathBelow = cubicPathBetweenBoxes(a, bBelow, fixed);
    const topA = portAnchor(a, 'top');
    const bottomBRight = portAnchor(bRight, 'bottom');
    const bottomBBelow = portAnchor(bBelow, 'bottom');
    expect(pathBeside.startsWith(`M ${topA.x} ${topA.y}`)).toBe(true);
    expect(pathBeside).toContain(`${bottomBRight.x} ${bottomBRight.y}`);
    expect(pathBelow.startsWith(`M ${topA.x} ${topA.y}`)).toBe(true);
    expect(pathBelow).toContain(`${bottomBBelow.x} ${bottomBBelow.y}`);
    // без fixed — горизонталь vs вертикаль дали бы разные якоря на A
    expect(cubicPathBetweenBoxes(a, bRight).startsWith('M 100 20')).toBe(true);
    expect(cubicPathBetweenBoxes(a, bBelow).startsWith('M 50 40')).toBe(true);
  });

  it('cubicPathBetweenBoxes входит и выходит под прямым углом к стороне порта', () => {
    // right → bottom (как линк к рамке группы снизу): касательные нормальны к рёбрам
    const path = cubicPathBetweenBoxes(a, bBelow, { from: 'right', to: 'bottom' });
    const m = path.match(
      /^M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)$/,
    );
    expect(m).toBeTruthy();
    const [, sx, sy, c1x, c1y, c2x, c2y, tx, ty] = m!.map(Number);
    expect(sx).toBe(100);
    expect(sy).toBe(20);
    expect(tx).toBe(50);
    expect(ty).toBe(240);
    // выход с right: первая касательная горизонтальна (c1.y === s.y, c1.x > s.x)
    expect(c1y).toBe(sy);
    expect(c1x).toBeGreaterThan(sx);
    // вход в bottom: вторая касательная вертикальна (c2.x === t.x, c2.y > t.y снаружи)
    expect(c2x).toBe(tx);
    expect(c2y).toBeGreaterThan(ty);
  });
});
