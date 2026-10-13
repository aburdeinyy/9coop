import { describe, expect, it } from 'vitest';
import { chatScopeKey } from '../src/app/core/utils/chat-scope';
import { GraphService } from '../src/app/core/services/graph.service';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

describe('chatScopeKey', () => {
  it('ключ node+thread', () => {
    expect(chatScopeKey('cursor-god', 't1')).toBe('cursor-god::t1');
    expect(chatScopeKey('cursor-god', null)).toBe('cursor-god::');
  });
});

describe('GraphService thread-scoped messages', () => {
  it('push в thread A не попадает в active thread B', () => {
    const svc = new GraphService(memoryStorage());
    const a = svc.createChatThread(GOD_NODE_ID);
    const b = svc.createChatThread(GOD_NODE_ID);
    svc.selectChatThread(GOD_NODE_ID, b);

    svc.pushChatMessage(
      GOD_NODE_ID,
      {
        id: 'm1',
        role: 'user',
        content: 'для A',
        timestamp: '2026-10-12T00:00:00.000Z',
      },
      a,
    );

    expect(svc.chatMessagesFor(GOD_NODE_ID, a).map((m) => m.content)).toContain('для A');
    expect(svc.chatMessagesFor(GOD_NODE_ID, b).map((m) => m.content)).not.toContain('для A');
    // active = B — без threadId пишет в B
    svc.pushChatMessage(GOD_NODE_ID, {
      id: 'm2',
      role: 'user',
      content: 'для B',
      timestamp: '2026-10-12T00:00:01.000Z',
    });
    expect(svc.chatMessagesFor(GOD_NODE_ID, b).map((m) => m.content)).toContain('для B');
  });
});

describe('draft per scope', () => {
  it('сохраняет разные черновики по ключу', () => {
    const drafts = new Map<string, string>();
    const keyA = chatScopeKey(GOD_NODE_ID, 't-a');
    const keyB = chatScopeKey(GOD_NODE_ID, 't-b');
    drafts.set(keyA, 'привет A');
    drafts.set(keyB, 'привет B');
    expect(drafts.get(keyA)).toBe('привет A');
    expect(drafts.get(keyB)).toBe('привет B');
  });
});
