import { describe, expect, it } from 'vitest';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import { runRuntime } from '../src/app/core/runtime/runtime-engine';
import { isAbortError } from '../src/app/core/runtime/abort';

const godNode: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { label: 'Cursor' },
};

function emptyGraph(): LayercoopGraph {
  return {
    version: 1,
    name: 'demo',
    updatedAt: '2026-09-03T00:00:00.000Z',
    nodes: [godNode],
    edges: [],
  };
}

describe('abort helpers', () => {
  it('isAbortError распознаёт DOMException AbortError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('nope'))).toBe(false);
  });
});

describe('runRuntime cancel', () => {
  it('уже aborted signal → сразу run:cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    const events = [];
    for await (const event of runRuntime(emptyGraph(), 'x', {
      signal: ac.signal,
      delay: async () => undefined,
      complete: async () => 'nope',
    })) {
      events.push(event);
    }
    expect(events.map((e) => e.type)).toEqual(['run:start', 'run:cancelled']);
  });

  it('abort во время delay → run:cancelled без токенов ответа', async () => {
    const ac = new AbortController();
    let delays = 0;
    const events = [];
    for await (const event of runRuntime(emptyGraph(), 'stop me', {
      signal: ac.signal,
      complete: async () => 'should-not-finish',
      delay: async () => {
        delays += 1;
        if (delays >= 1) ac.abort();
      },
    })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'run:cancelled')).toBe(true);
    expect(events.some((e) => e.type === 'run:end')).toBe(false);
    expect(
      events
        .filter((e) => e.type === 'token')
        .map((e) => e.text)
        .join(''),
    ).not.toContain('should-not-finish');
  });
});
