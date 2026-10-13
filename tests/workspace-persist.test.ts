import { describe, expect, it } from 'vitest';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import {
  WORKSPACE_STORAGE_KEY,
  chatMessagesOf,
  loadWorkspace,
  maxArtifactCounter,
  maxGodCounter,
  normalizeNodeChats,
  parseWorkspace,
  saveWorkspace,
  type StorageLike,
  type WorkspaceSnapshot,
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

const sampleGraph: LayercoopGraph = {
  version: 1,
  name: 'my-board',
  updatedAt: '2026-09-03T12:00:00.000Z',
  nodes: [
    {
      id: GOD_NODE_ID,
      type: 'god',
      position: { x: 10, y: 20 },
      data: {
        label: 'Cursor',
        runner: 'cursor',
        model: 'composer-2.5',
        baseUrl: '/cursor-api',
        apiKey: 'key_secret',
        temperature: 0.1,
        isolated: false,
      },
    },
    {
      id: 'artifact-3',
      type: 'artifact',
      position: { x: 100, y: 50 },
      data: {
        kind: 'skill',
        label: 'Skill',
        prompt: 'hello',
        connected: true,
      },
    },
  ],
  edges: [{ id: 'edge-artifact-3', source: GOD_NODE_ID, target: 'artifact-3' }],
};

describe('workspace-persist', () => {
  it('parseWorkspace восстанавливает граф с apiKey и nodeChats', () => {
    const snap: WorkspaceSnapshot = {
      version: 1,
      graph: sampleGraph,
      selectedNodeId: 'artifact-3',
      nodeChats: normalizeNodeChats({
        [GOD_NODE_ID]: [
          { id: 'm1', role: 'user', content: 'hi', timestamp: '2026-09-03T12:01:00.000Z' },
        ],
      }),
      sidebarWidth: 400,
      pan: { x: 12, y: -4 },
      zoom: 1.2,
    };

    const parsed = parseWorkspace(JSON.stringify(snap));
    expect(parsed?.graph.name).toBe('my-board');
    expect(parsed?.graph.nodes[0].data).toMatchObject({ apiKey: 'key_secret', runner: 'cursor' });
    expect(parsed?.selectedNodeId).toBe('artifact-3');
    expect(chatMessagesOf(parsed?.nodeChats[GOD_NODE_ID])).toHaveLength(1);
    expect(parsed?.sidebarWidth).toBe(400);
    expect(parsed?.pan).toEqual({ x: 12, y: -4 });
    expect(parsed?.zoom).toBe(1.2);
  });

  it('parseWorkspace возвращает null на мусор', () => {
    expect(parseWorkspace('')).toBeNull();
    expect(parseWorkspace('{')).toBeNull();
    expect(parseWorkspace('{"version":1}')).toBeNull();
  });

  it('save/load roundtrip через StorageLike', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      graph: sampleGraph,
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
    });

    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBeTruthy();
    const loaded = loadWorkspace(storage);
    expect(loaded?.graph.edges).toHaveLength(1);
    expect(loaded?.graph.nodes[0].data).toMatchObject({ apiKey: 'key_secret' });
  });

  it('saveWorkspace мержит partial поверх уже сохранённого', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      graph: sampleGraph,
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
      sidebarWidth: 340,
      pan: { x: 1, y: 2 },
      zoom: 1,
    });
    saveWorkspace(storage, { sidebarWidth: 480 });

    const loaded = loadWorkspace(storage);
    expect(loaded?.sidebarWidth).toBe(480);
    expect(loaded?.graph.name).toBe('my-board');
    expect(loaded?.pan).toEqual({ x: 1, y: 2 });
  });

  it('boardAuraEnabled сохраняется и по умолчанию true', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, { graph: sampleGraph, selectedNodeId: GOD_NODE_ID, nodeChats: {} });
    expect(loadWorkspace(storage)?.boardAuraEnabled).toBe(true);

    saveWorkspace(storage, { boardAuraEnabled: false });
    expect(loadWorkspace(storage)?.boardAuraEnabled).toBe(false);

    const parsed = parseWorkspace(
      JSON.stringify({
        version: 1,
        graph: sampleGraph,
        selectedNodeId: GOD_NODE_ID,
        nodeChats: {},
        boardAuraEnabled: false,
      }),
    );
    expect(parsed?.boardAuraEnabled).toBe(false);
  });

  it('maxGodCounter берёт max из god-N', () => {
    expect(maxGodCounter(sampleGraph)).toBe(0);
    const withSub: LayercoopGraph = {
      ...sampleGraph,
      nodes: [
        ...sampleGraph.nodes,
        {
          id: 'god-3',
          type: 'god',
          position: { x: 1, y: 1 },
          data: {
            label: 'DeepSeek',
            runner: 'openai-compatible',
            model: 'x',
            baseUrl: '',
            apiKey: '',
            temperature: 0.2,
            isolated: false,
          },
        },
      ],
    };
    expect(maxGodCounter(withSub)).toBe(3);
  });

  it('maxArtifactCounter берёт max из artifact-N', () => {
    expect(maxArtifactCounter(sampleGraph)).toBe(3);
    expect(maxArtifactCounter({ ...sampleGraph, nodes: [sampleGraph.nodes[0]] })).toBe(0);
  });

  it('partial save без prev не пишет граф без GOD — workspace остаётся читаемым', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, { pan: { x: 4, y: 8 }, zoom: 1.1 });

    const loaded = loadWorkspace(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.pan).toEqual({ x: 4, y: 8 });
    expect(loaded?.graph.nodes.some((n) => n.id === GOD_NODE_ID && n.type === 'god')).toBe(true);
  });

  it('null-координаты (JSON.stringify NaN) не роняют весь граф и GOD-конфиг', () => {
    const raw = {
      version: 1,
      graph: {
        ...sampleGraph,
        nodes: [
          sampleGraph.nodes[0],
          {
            ...sampleGraph.nodes[1],
            position: { x: null, y: null },
          },
        ],
      },
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
    };
    const parsed = parseWorkspace(JSON.stringify(raw));
    expect(parsed).not.toBeNull();
    expect(parsed?.graph.nodes[0].data).toMatchObject({
      runner: 'cursor',
      apiKey: 'key_secret',
    });
  });
});

describe('GraphService persistence', () => {
  it('поднимает сохранённый граф и GOD-конфиг после нового инстанса', async () => {
    const { GraphService } = await import('../src/app/core/services/graph.service');
    const storage = memoryStorage();
    const first = new GraphService(storage);
    first.setGraphName('persisted-board');
    first.updateGodConfig({ runner: 'cursor', apiKey: 'key_abc', model: 'composer-2.5' });
    const skillId = first.addArtifactNode('skill');
    first.connectToGod(skillId);
    first.pushChatMessage(GOD_NODE_ID, {
      id: 'c1',
      role: 'user',
      content: 'ping',
      timestamp: '2026-09-03T12:00:00.000Z',
    });

    const second = new GraphService(storage);
    expect(second.graph().name).toBe('persisted-board');
    const god = second.graph().nodes.find((n) => n.id === GOD_NODE_ID);
    expect(god?.data).toMatchObject({ runner: 'cursor', apiKey: 'key_abc' });
    expect(second.graph().nodes.some((n) => n.id === skillId)).toBe(true);
    expect(second.chatMessagesFor(GOD_NODE_ID)).toHaveLength(1);

    const thirdId = second.addArtifactNode('rule');
    expect(thirdId).not.toBe(skillId);
  });

  it('настройки GOD (не дефолтный runner) переживают persistView и новый инстанс', async () => {
    const { GraphService } = await import('../src/app/core/services/graph.service');
    const storage = memoryStorage();
    const first = new GraphService(storage);
    first.updateGodConfig({
      runner: 'claude-code',
      model: 'claude-opus-5',
      apiKey: 'sk-ant-test',
      isolated: true,
      label: 'My GOD',
    });

    saveWorkspace(storage, { pan: { x: 10, y: 20 }, zoom: 1.25 });

    const second = new GraphService(storage);
    const god = second.graph().nodes.find((n) => n.id === GOD_NODE_ID);
    expect(god?.data).toMatchObject({
      runner: 'claude-code',
      model: 'claude-opus-5',
      apiKey: 'sk-ant-test',
      isolated: true,
      label: 'My GOD',
    });
  });

  it('битый JSON в storage не затирается дефолтным графом при старте GraphService', async () => {
    const { GraphService } = await import('../src/app/core/services/graph.service');
    const storage = memoryStorage({ [WORKSPACE_STORAGE_KEY]: '{not-json' });
    new GraphService(storage);
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('{not-json');
  });
});
