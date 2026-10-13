import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';
import {
  chatMessagesOf,
  normalizeNodeChats,
  parseWorkspace,
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

describe('nodeChats threads migrate', () => {
  it('массив сообщений → один тред', () => {
    const out = normalizeNodeChats({
      [GOD_NODE_ID]: [
        { id: 'm1', role: 'user', content: 'hi there', timestamp: '2026-09-03T12:00:00.000Z' },
      ],
    });
    const state = out[GOD_NODE_ID];
    expect(state.threads).toHaveLength(1);
    expect(chatMessagesOf(state)).toEqual([
      { id: 'm1', role: 'user', content: 'hi there', timestamp: '2026-09-03T12:00:00.000Z' },
    ]);
    expect(state.threads[0]!.title).toContain('hi there');
    expect(state.activeThreadId).toBe(state.threads[0]!.id);
  });

  it('новый формат threads читается как есть', () => {
    const out = normalizeNodeChats({
      [GOD_NODE_ID]: {
        activeThreadId: 't2',
        threads: [
          {
            id: 't1',
            title: 'Старый',
            createdAt: '2026-09-03T12:00:00.000Z',
            updatedAt: '2026-09-03T12:00:00.000Z',
            messages: [],
          },
          {
            id: 't2',
            title: 'Активный',
            createdAt: '2026-09-03T12:01:00.000Z',
            updatedAt: '2026-09-03T12:01:00.000Z',
            messages: [
              { id: 'm1', role: 'user', content: 'x', timestamp: '2026-09-03T12:01:00.000Z' },
            ],
          },
        ],
      },
    });
    expect(out[GOD_NODE_ID].activeThreadId).toBe('t2');
    expect(chatMessagesOf(out[GOD_NODE_ID])).toHaveLength(1);
  });

  it('parseWorkspace мигрирует legacy chatMessages в тред', () => {
    const raw = JSON.stringify({
      version: 1,
      graph: sampleGraph,
      selectedNodeId: GOD_NODE_ID,
      chatMessages: [
        { id: 'old', role: 'user', content: 'legacy', timestamp: '2026-09-03T12:00:00.000Z' },
      ],
    });
    const parsed = parseWorkspace(raw);
    expect(chatMessagesOf(parsed!.nodeChats[GOD_NODE_ID])).toEqual([
      { id: 'old', role: 'user', content: 'legacy', timestamp: '2026-09-03T12:00:00.000Z' },
    ]);
  });
});

describe('GraphService chat threads', () => {
  it('create/select thread изолирует сообщения', () => {
    const svc = new GraphService(memoryStorage());
    svc.pushChatMessage(GOD_NODE_ID, {
      id: 'a',
      role: 'user',
      content: 'first thread',
      timestamp: '2026-09-03T12:00:00.000Z',
    });
    const t1 = svc.activeThreadId(GOD_NODE_ID);
    const t2 = svc.createChatThread(GOD_NODE_ID);
    expect(t2).not.toBe(t1);
    expect(svc.chatMessagesFor(GOD_NODE_ID)).toEqual([]);
    svc.pushChatMessage(GOD_NODE_ID, {
      id: 'b',
      role: 'user',
      content: 'second',
      timestamp: '2026-09-03T12:01:00.000Z',
    });
    expect(svc.chatMessagesFor(GOD_NODE_ID)[0].content).toBe('second');
    svc.selectChatThread(GOD_NODE_ID, t1!);
    expect(svc.chatMessagesFor(GOD_NODE_ID)[0].content).toBe('first thread');
    expect(svc.chatThreadsFor(GOD_NODE_ID)).toHaveLength(2);
  });

  it('закрытие и открытие сайдбара чата', () => {
    const svc = new GraphService(memoryStorage());
    expect(svc.chatSidebarOpen()).toBe(true);
    svc.closeChatSidebar();
    expect(svc.chatSidebarOpen()).toBe(false);
    svc.selectNode(GOD_NODE_ID);
    expect(svc.chatSidebarOpen()).toBe(true);
  });
});
