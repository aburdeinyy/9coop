import type { ChatMessage } from '../models/graph.model';

export const CHAT_DRAG_MIME = 'application/x-layercoop-chat';

export type ChatDragPayload = {
  sourceNodeId: string;
  threadId: string;
};

export function serializeChatDragPayload(payload: ChatDragPayload): string {
  return JSON.stringify(payload);
}

export function parseChatDragPayload(raw: string | null | undefined): ChatDragPayload | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const sourceNodeId = typeof o['sourceNodeId'] === 'string' ? o['sourceNodeId'].trim() : '';
    const threadId = typeof o['threadId'] === 'string' ? o['threadId'].trim() : '';
    if (!sourceNodeId || !threadId) return null;
    return { sourceNodeId, threadId };
  } catch {
    return null;
  }
}

/** Короткий markdown-prompt для новой ноды из хвоста переписки. */
export function promptFromChatMessages(messages: ChatMessage[], max = 6): string {
  const slice = messages.filter((m) => m.content.trim()).slice(-max);
  if (!slice.length) {
    return 'Чат, вынесенный на доску Layercoop. Продолжи работу с учётом контекста.';
  }
  const blocks = slice.map((m) => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const text = m.content.trim().slice(0, 480);
    return `### ${role}\n\n${text}`;
  });
  return [
    'Контекст чата, вынесенного на доску. Продолжай с учётом истории:',
    '',
    ...blocks,
  ].join('\n\n');
}
