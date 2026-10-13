import { describe, expect, it } from 'vitest';
import {
  GOD_NODE_ID,
  defaultGodData,
  type GraphNode,
  type LayercoopGraph,
} from '../src/app/core/models/graph.model';
import {
  connectedSubGods,
  isPrimaryGod,
  listGodNodes,
  resolveExecutor,
} from '../src/app/core/utils/god-nodes';
import {
  loadWorkspace,
  parseWorkspace,
  saveWorkspace,
  type StorageLike,
} from '../src/app/core/utils/workspace-persist';

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const primary: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { ...defaultGodData(), label: 'Cursor' },
};

const deepseek: GraphNode = {
  id: 'god-2',
  type: 'god',
  position: { x: 200, y: 0 },
  data: {
    ...defaultGodData(),
    label: 'DeepSeek',
    runner: 'openai-compatible',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
  },
};

function graph(nodes: GraphNode[], edges: LayercoopGraph['edges'] = []): LayercoopGraph {
  return {
    version: 1,
    name: 'demo',
    updatedAt: '2026-09-25T00:00:00.000Z',
    nodes,
    edges,
  };
}

describe('god-nodes helpers', () => {
  it('isPrimaryGod только для cursor-god', () => {
    expect(isPrimaryGod(GOD_NODE_ID)).toBe(true);
    expect(isPrimaryGod('god-2')).toBe(false);
  });

  it('listGodNodes возвращает все type:god', () => {
    const ids = listGodNodes(graph([primary, deepseek])).map((n) => n.id);
    expect(ids).toEqual([GOD_NODE_ID, 'god-2']);
  });

  it('resolveExecutor берёт фокус-god или primary', () => {
    const g = graph([primary, deepseek]);
    expect(resolveExecutor(g, 'god-2').label).toBe('DeepSeek');
    expect(resolveExecutor(g, GOD_NODE_ID).label).toBe('Cursor');
    expect(resolveExecutor(g, 'missing').label).toBe('Cursor');
  });

  it('connectedSubGods — только god reachable от primary', () => {
    const linked = graph([primary, deepseek], [
      { id: 'edge-a', source: GOD_NODE_ID, target: 'god-2' },
    ]);
    expect(connectedSubGods(linked).map((n) => n.id)).toEqual(['god-2']);

    const solo = graph([primary, deepseek]);
    expect(connectedSubGods(solo)).toEqual([]);
  });
});

describe('persist several gods', () => {
  it('normalizeGraph принимает primary + sub-god', () => {
    const snap = {
      version: 1 as const,
      graph: graph([primary, deepseek]),
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
    };
    const parsed = parseWorkspace(JSON.stringify(snap));
    expect(parsed?.graph.nodes.filter((n) => n.type === 'god')).toHaveLength(2);
    expect(parsed?.graph.nodes.some((n) => n.id === 'god-2')).toBe(true);
  });

  it('save/load сохраняет sub-god', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      graph: graph([primary, deepseek]),
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
    });
    const loaded = loadWorkspace(storage);
    expect(loaded?.graph.nodes.map((n) => n.id).sort()).toEqual(
      [GOD_NODE_ID, 'god-2'].sort(),
    );
  });
});
