import { describe, expect, it } from 'vitest';
import {
  CHAT_DRAG_MIME,
  parseChatDragPayload,
  promptFromChatMessages,
  serializeChatDragPayload,
} from '../src/app/core/utils/chat-to-node';
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

describe('chat-to-node', () => {
  it('сериализует drag payload', () => {
    const raw = serializeChatDragPayload({
      sourceNodeId: GOD_NODE_ID,
      threadId: 't1',
    });
    expect(CHAT_DRAG_MIME).toContain('layercoop');
    expect(parseChatDragPayload(raw)).toEqual({
      sourceNodeId: GOD_NODE_ID,
      threadId: 't1',
    });
    expect(parseChatDragPayload('nope')).toBeNull();
  });

  it('promptFromChatMessages берёт хвост истории в markdown', () => {
    const prompt = promptFromChatMessages([
      {
        id: '1',
        role: 'user',
        content: 'сделай skill',
        timestamp: '2026-10-13T00:00:00.000Z',
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Ок — **готово**',
        timestamp: '2026-10-13T00:00:01.000Z',
      },
    ]);
    expect(prompt).toContain('### User');
    expect(prompt).toContain('### Assistant');
    expect(prompt).toContain('сделай skill');
    expect(prompt).toContain('**готово**');
  });

  it('spawnArtifactFromChatThread создаёт ноду с историей и связью к GOD', () => {
    const svc = new GraphService(memoryStorage());
    const threadId = svc.createChatThread(GOD_NODE_ID);
    svc.pushChatMessage(GOD_NODE_ID, {
      id: 'u1',
      role: 'user',
      content: 'проанализируй jira',
      timestamp: '2026-10-13T00:00:00.000Z',
    }, threadId);
    svc.pushChatMessage(GOD_NODE_ID, {
      id: 'a1',
      role: 'assistant',
      content: 'Начинаю',
      timestamp: '2026-10-13T00:00:01.000Z',
    }, threadId);

    const id = svc.spawnArtifactFromChatThread(GOD_NODE_ID, threadId, {
      x: 420,
      y: 180,
    });
    expect(id).toBeTruthy();
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.position).toEqual({ x: 420, y: 180 });
    expect(node.data.prompt).toContain('проанализируй jira');
    expect(svc.chatMessagesFor(id!).map((m) => m.content)).toEqual(
      expect.arrayContaining(['проанализируй jira', 'Начинаю']),
    );
    expect(svc.isDirectlyLinkedToGod(id!)).toBe(true);
    expect(svc.selectedNodeId()).toBe(id);
  });
});
