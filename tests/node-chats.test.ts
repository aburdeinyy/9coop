import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';
import {
  WORKSPACE_STORAGE_KEY,
  chatMessagesOf,
  loadWorkspace,
  normalizeNodeChats,
  parseWorkspace,
  saveWorkspace,
  type StorageLike,
} from '../src/app/core/utils/workspace-persist';
import { GraphService } from '../src/app/core/services/graph.service';

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
  name: 'board',
  updatedAt: '2026-09-03T12:00:00.000Z',
  nodes: [
    {
      id: GOD_NODE_ID,
      type: 'god',
      position: { x: 0, y: 0 },
      data: {
        label: 'Cursor',
        runner: 'cursor',
        model: 'composer-2.5',
        baseUrl: '',
        apiKey: '',
        temperature: 0.2,
        isolated: false,
      },
    },
  ],
  edges: [],
};

describe('nodeChats persist', () => {
  it('parseWorkspace читает nodeChats', () => {
    const raw = JSON.stringify({
      version: 1,
      graph: sampleGraph,
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {
        [GOD_NODE_ID]: [
          { id: 'm1', role: 'user', content: 'hi', timestamp: '2026-09-03T12:00:00.000Z' },
        ],
        'artifact-1': [
          { id: 'm2', role: 'assistant', content: 'ok', timestamp: '2026-09-03T12:01:00.000Z' },
        ],
      },
    });
    const parsed = parseWorkspace(raw);
    expect(chatMessagesOf(parsed?.nodeChats[GOD_NODE_ID])).toHaveLength(1);
    expect(chatMessagesOf(parsed?.nodeChats['artifact-1'])[0].content).toBe('ok');
  });

  it('миграрует старый chatMessages → nodeChats[GOD]', () => {
    const raw = JSON.stringify({
      version: 1,
      graph: sampleGraph,
      selectedNodeId: GOD_NODE_ID,
      chatMessages: [
        { id: 'old', role: 'user', content: 'legacy', timestamp: '2026-09-03T12:00:00.000Z' },
      ],
    });
    const parsed = parseWorkspace(raw);
    expect(chatMessagesOf(parsed?.nodeChats[GOD_NODE_ID])).toEqual([
      { id: 'old', role: 'user', content: 'legacy', timestamp: '2026-09-03T12:00:00.000Z' },
    ]);
  });

  it('save/load roundtrip nodeChats', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      graph: sampleGraph,
      selectedNodeId: GOD_NODE_ID,
      nodeChats: normalizeNodeChats({
        [GOD_NODE_ID]: [
          { id: 'a', role: 'user', content: 'x', timestamp: '2026-09-03T12:00:00.000Z' },
        ],
      }),
    });
    const loaded = loadWorkspace(storage);
    expect(chatMessagesOf(loaded?.nodeChats[GOD_NODE_ID])[0].content).toBe('x');
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBeTruthy();
  });
});

describe('GraphService nodeChats API', () => {
  it('пишет сообщения в чат конкретной ноды', () => {
    const storage = memoryStorage();
    const svc = new GraphService(storage);
    const skillId = svc.addArtifactNode('skill');

    svc.pushChatMessage(GOD_NODE_ID, {
      id: 'g1',
      role: 'user',
      content: 'god',
      timestamp: '2026-09-03T12:00:00.000Z',
    });
    svc.pushChatMessage(skillId, {
      id: 's1',
      role: 'user',
      content: 'skill',
      timestamp: '2026-09-03T12:00:00.000Z',
    });
    svc.appendChatContent(skillId, 's1', '-more');

    expect(svc.chatMessagesFor(GOD_NODE_ID)).toHaveLength(1);
    expect(svc.chatMessagesFor(skillId)[0].content).toBe('skill-more');
    expect(svc.chatMessagesFor('missing')).toEqual([]);
  });
});
