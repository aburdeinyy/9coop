import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import {
  findNodeAtWorld,
  nodeContainsPoint,
  portAnchor,
  wirePreviewPath,
} from '../src/app/core/utils/edge-path';

function skill(id: string, x: number, y: number): GraphNode {
  return {
    id,
    type: 'artifact',
    position: { x, y },
    data: { kind: 'skill', label: id, prompt: '', connected: false },
  };
}

describe('node ports / hit-test', () => {
  it('nodeContainsPoint и findNodeAtWorld', () => {
    const a = skill('a', 0, 0); // 160×72
    const b = skill('b', 200, 0);
    expect(nodeContainsPoint({ x: 0, y: 0, w: 160, h: 72 }, 10, 10)).toBe(true);
    expect(nodeContainsPoint({ x: 0, y: 0, w: 160, h: 72 }, 300, 10)).toBe(false);

    expect(findNodeAtWorld([a, b], 20, 20)?.id).toBe('a');
    expect(findNodeAtWorld([a, b], 220, 20)?.id).toBe('b');
    expect(findNodeAtWorld([a, b], 20, 20, 'a')).toBeNull();
    expect(findNodeAtWorld([a, b], 900, 900)).toBeNull();
  });

  it('portAnchor на серединах сторон', () => {
    const box = { x: 0, y: 0, w: 100, h: 40 };
    expect(portAnchor(box, 'left')).toEqual({ x: 0, y: 20 });
    expect(portAnchor(box, 'right')).toEqual({ x: 100, y: 20 });
    expect(portAnchor(box, 'top')).toEqual({ x: 50, y: 0 });
    expect(portAnchor(box, 'bottom')).toEqual({ x: 50, y: 40 });
  });

  it('wirePreviewPath — линия от порта к курсору', () => {
    expect(wirePreviewPath(10, 20, 100, 80)).toBe('M 10 20 L 100 80');
  });
});
