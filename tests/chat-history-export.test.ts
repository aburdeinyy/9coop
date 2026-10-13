import { describe, expect, it } from 'vitest';
import {
  buildChatHistoryDocument,
  chatHistoryFilename,
  isHistoryCommand,
} from '../src/app/core/utils/chat-history-export';
import type { ChatMessage } from '../src/app/core/models/graph.model';

const messages: ChatMessage[] = [
  {
    id: 'u1',
    role: 'user',
    content: 'сделай skill',
    timestamp: '2026-10-08T12:00:00.000Z',
  },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Уточню.',
    timestamp: '2026-10-08T12:00:05.000Z',
    steps: [
      {
        id: 's1',
        kind: 'thought',
        label: 'мысль',
        text: 'нужно спросить про GitLab',
        status: 'done',
      },
      {
        id: 's2',
        kind: 'tool',
        label: 'Read',
        text: '',
        status: 'done',
      },
    ],
    stats: {
      durationMs: 2400,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    },
  },
];

describe('chat-history-export', () => {
  it('распознаёт /history', () => {
    expect(isHistoryCommand('/history')).toBe('md');
    expect(isHistoryCommand('  /History  ')).toBe('md');
    expect(isHistoryCommand('/history json')).toBe('json');
    expect(isHistoryCommand('/historyjson')).toBeNull();
    expect(isHistoryCommand('расскажи /history')).toBeNull();
  });

  it('собирает markdown с промптами, мыслями и tools', () => {
    const doc = buildChatHistoryDocument({
      graphName: 'board',
      nodeId: 'cursor-god',
      nodeLabel: 'GOD',
      nodeKind: 'god',
      threadId: 't1',
      threadTitle: 'сделай skill',
      exportedAt: '2026-10-08T12:01:00.000Z',
      messages,
    });
    expect(doc.markdown).toContain('# Layercoop chat history');
    expect(doc.markdown).toContain('сделай skill');
    expect(doc.markdown).toContain('нужно спросить про GitLab');
    expect(doc.markdown).toContain('tool: Read');
    expect(doc.markdown).toContain('2.4с');
    expect(doc.json.messages).toHaveLength(2);
    expect(doc.json.messages[1]?.steps?.[0]?.text).toContain('GitLab');
  });

  it('filename безопасный', () => {
    expect(chatHistoryFilename('My Board!', 'GOD', 't1', 'md')).toMatch(
      /^layercoop-history-my-board-god-t1-.*\.md$/,
    );
  });
});
