import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createBridgeServer } from '../bridge/src/server';
import { DEFAULT_RUNNERS, resolveRunner } from '../bridge/src/runners';
import { createEventQueue, createLineSplitter } from '../bridge/src/event-queue';
import type { AgentRunner, BridgeSseEvent } from '../bridge/src/types';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

const noop: AgentRunner = async function* () {
  yield { type: 'done', result: '' };
};

describe('runner registry', () => {
  it('знает три local-раннера', () => {
    expect(Object.keys(DEFAULT_RUNNERS).sort()).toEqual(['claude-code', 'cursor', 'opencode']);
  });

  it('resolveRunner выбирает по runner, неизвестный падает на cursor', () => {
    expect(resolveRunner('claude-code')).toBe(DEFAULT_RUNNERS['claude-code']);
    expect(resolveRunner('opencode')).toBe(DEFAULT_RUNNERS.opencode);
    expect(resolveRunner('нет такого')).toBe(DEFAULT_RUNNERS.cursor);
    expect(resolveRunner(undefined)).toBe(DEFAULT_RUNNERS.cursor);
  });

  it('override подменяет один runner, остальные остаются', () => {
    expect(resolveRunner('opencode', { opencode: noop })).toBe(noop);
    expect(resolveRunner('cursor', { opencode: noop })).toBe(DEFAULT_RUNNERS.cursor);
  });
});

describe('bridge routing по runner', () => {
  it('POST /v1/run с runner=claude-code уходит в claude-code раннер', async () => {
    const claudeCode = vi.fn(async function* (): AsyncGenerator<BridgeSseEvent> {
      yield { type: 'done', result: 'from claude-code' };
    });
    const cursor = vi.fn(async function* (): AsyncGenerator<BridgeSseEvent> {
      yield { type: 'done', result: 'from cursor' };
    });

    const server = createBridgeServer({ runners: { 'claude-code': claudeCode, cursor } });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runner: 'claude-code',
          apiKey: '',
          prompt: 'hi',
          isolated: true,
        }),
      });
      const text = await res.text();
      expect(text).toContain('from claude-code');
      expect(cursor).not.toHaveBeenCalled();
      expect(claudeCode.mock.calls[0]?.[0]).toMatchObject({
        runner: 'claude-code',
        isolated: true,
      });
    } finally {
      server.close();
    }
  });

  it('legacy runtime в body всё ещё работает', async () => {
    const claudeCode = vi.fn(async function* (): AsyncGenerator<BridgeSseEvent> {
      yield { type: 'done', result: 'legacy' };
    });
    const server = createBridgeServer({ runners: { 'claude-code': claudeCode } });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtime: 'claude-code', apiKey: '', prompt: 'hi' }),
      });
      expect(await res.text()).toContain('legacy');
      expect(claudeCode).toHaveBeenCalledOnce();
    } finally {
      server.close();
    }
  });

  it('без runner — прежнее поведение, cursor', async () => {
    const cursor = vi.fn(async function* (): AsyncGenerator<BridgeSseEvent> {
      yield { type: 'done', result: 'from cursor' };
    });
    const server = createBridgeServer({ runners: { cursor } });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'k', prompt: 'hi' }),
      });
      expect(await res.text()).toContain('from cursor');
      expect(cursor).toHaveBeenCalledOnce();
    } finally {
      server.close();
    }
  });

  it('GET /health перечисляет доступные runners', async () => {
    const server = createBridgeServer({ runAgent: noop });
    const port = await listen(server);
    try {
      const json = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
        runners: string[];
      };
      expect(json.runners).toContain('claude-code');
      expect(json.runners).toContain('opencode');
      expect(json.runners).toContain('cursor');
    } finally {
      server.close();
    }
  });
});

describe('event queue', () => {
  it('отдаёт то, что положили до close, и завершается', async () => {
    const queue = createEventQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();
    const seen: number[] = [];
    for await (const item of queue.stream()) seen.push(item);
    expect(seen).toEqual([1, 2]);
  });

  it('ждёт push, пришедший позже', async () => {
    const queue = createEventQueue<string>();
    setTimeout(() => {
      queue.push('поздний');
      queue.close();
    }, 5);
    const seen: string[] = [];
    for await (const item of queue.stream()) seen.push(item);
    expect(seen).toEqual(['поздний']);
  });

  it('push после close игнорируется', async () => {
    const queue = createEventQueue<number>();
    queue.close();
    queue.push(42);
    const seen: number[] = [];
    for await (const item of queue.stream()) seen.push(item);
    expect(seen).toEqual([]);
  });
});

describe('line splitter', () => {
  it('склеивает строку, разорванную между чанками', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('{"a":1}\n{"b":');
    expect(lines).toEqual(['{"a":1}']);
    splitter.push('2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('flush отдаёт хвост без перевода строки', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('последняя');
    expect(lines).toEqual([]);
    splitter.flush();
    expect(lines).toEqual(['последняя']);
  });

  it('пустые строки пропускаются', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('a\n\n\nb\n');
    expect(lines).toEqual(['a', 'b']);
  });
});
