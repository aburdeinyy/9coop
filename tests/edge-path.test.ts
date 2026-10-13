import { describe, expect, it } from 'vitest';
import { cubicEdgePath, nodeBox } from '../src/app/core/utils/edge-path';
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
