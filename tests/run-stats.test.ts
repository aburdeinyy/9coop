import { describe, expect, it } from 'vitest';
import {
  formatDurationMs,
  formatTokenCount,
  formatRunStatsLabel,
  mergeRunStats,
  normalizeChatRunStats,
  runStatsBarSegments,
  sumTokenUsage,
} from '../src/app/core/utils/run-stats';
import { parseBridgeSseChunk } from '../src/app/core/runtime/llm-provider';
import {
  chatMessagesOf,
  normalizeNodeChats,
} from '../src/app/core/utils/workspace-persist';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';

describe('run-stats', () => {
  it('normalizeChatRunStats читает duration + usage', () => {
    expect(
      normalizeChatRunStats({
        durationMs: 2400,
        usage: {
          inputTokens: 9100,
          outputTokens: 3300,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
          totalTokens: 12400,
        },
      }),
    ).toEqual({
      durationMs: 2400,
      usage: {
        inputTokens: 9100,
        outputTokens: 3300,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        totalTokens: 12400,
      },
    });
    expect(normalizeChatRunStats(null)).toBeUndefined();
    expect(normalizeChatRunStats({ durationMs: -1 })).toBeUndefined();
  });

  it('sumTokenUsage и mergeRunStats складывают токены', () => {
    expect(
      sumTokenUsage(
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1, totalTokens: 6 },
      ),
    ).toEqual({
      inputTokens: 13,
      outputTokens: 7,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      totalTokens: 21,
    });

    expect(
      mergeRunStats(
        { durationMs: 1000, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        { durationMs: 500, usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 } },
      ),
    ).toEqual({
      durationMs: 1500,
      usage: {
        inputTokens: 3,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 4,
      },
    });
  });

  it('format + bar segments', () => {
    expect(formatDurationMs(850)).toBe('900мс');
    expect(formatDurationMs(2400)).toBe('2.4с');
    expect(formatDurationMs(65_000)).toBe('1м 5с');
    expect(formatTokenCount(3300)).toBe('3.3k');
    expect(formatTokenCount(420)).toBe('420');

    expect(
      formatRunStatsLabel({
        durationMs: 2400,
        usage: { inputTokens: 9100, outputTokens: 3300, totalTokens: 12400 },
      }),
    ).toContain('2.4с');

    const segs = runStatsBarSegments({
      inputTokens: 90,
      outputTokens: 10,
      cacheReadTokens: 0,
      totalTokens: 100,
    });
    expect(segs[0]).toMatchObject({ key: 'input', pct: 90 });
    expect(segs.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });

  it('parseBridgeSseChunk сохраняет usage на done', () => {
    const events = parseBridgeSseChunk(
      'data: {"type":"done","result":"ok","durationMs":1200,"usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}\n\n',
    );
    expect(events[0]).toEqual({
      type: 'done',
      result: 'ok',
      durationMs: 1200,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it('normalizeNodeChats сохраняет stats на сообщении', () => {
    const chats = normalizeNodeChats({
      [GOD_NODE_ID]: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'hi',
          timestamp: '2026-09-03T12:00:00.000Z',
          stats: {
            durationMs: 1000,
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        },
      ],
    });
    expect(chatMessagesOf(chats[GOD_NODE_ID])[0].stats).toEqual({
      durationMs: 1000,
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 3,
      },
    });
  });
});
