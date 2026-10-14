import { describe, expect, it, vi } from 'vitest';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import {
  completeRunner,
  streamRunner,
} from '../src/app/core/runtime/runners';
import { createOpenAiCompatibleRunner } from '../src/app/core/runtime/runners/openai-compatible';
import type { ChatContext } from '../src/app/core/utils/compose-context';
import type { BridgeSseEvent } from '../src/app/core/runtime/llm-provider';

function contextFor(patch: Partial<ReturnType<typeof defaultGodData>> = {}): ChatContext {
  return {
    systemPrompt: 'sys',
    userPrompt: 'hi',
    connectedArtifacts: [],
    god: { ...defaultGodData(), ...patch },
    focusNodeId: GOD_NODE_ID,
  };
}

describe('openai-compatible client runner', () => {
  it('отдаёт token + done при успешном ответе', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok from openai' } }],
      }),
    });

    const run = createOpenAiCompatibleRunner({ fetchImpl });
    const god = {
      ...defaultGodData(),
      runner: 'openai-compatible' as const,
      model: 'qwen',
      baseUrl: 'http://llm.local/v1',
      apiKey: 'k',
    };
    const events: BridgeSseEvent[] = [];
    for await (const ev of run(god, contextFor(god))) events.push(ev);

    expect(events).toEqual([
      { type: 'token', text: 'ok from openai' },
      { type: 'done', result: 'ok from openai' },
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/chat/completions');
  });

  it('отдаёт error при HTTP-ошибке', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'unauthorized' } }),
    });
    const run = createOpenAiCompatibleRunner({ fetchImpl });
    const god = {
      ...defaultGodData(),
      runner: 'openai' as const,
      model: 'gpt-4.1',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'bad',
    };
    const events: BridgeSseEvent[] = [];
    for await (const ev of run(god, contextFor(god))) events.push(ev);
    expect(events).toEqual([{ type: 'error', message: 'unauthorized' }]);
  });
});

describe('streamRunner / completeRunner registry', () => {
  it('openai-compatible идёт через client runner', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'via registry' } }],
      }),
    });
    const god = {
      ...defaultGodData(),
      runner: 'openai-compatible' as const,
      model: 'qwen',
      baseUrl: 'http://llm.local/v1',
      apiKey: 'k',
    };
    await expect(completeRunner(god, contextFor(god), { fetchImpl })).resolves.toBe('via registry');
  });

  it('anthropic — stub error', async () => {
    const events: BridgeSseEvent[] = [];
    const god = { ...defaultGodData(), runner: 'anthropic' as const };
    for await (const ev of streamRunner(god, contextFor(god))) events.push(ev);
    expect(events[0]?.type).toBe('error');
    expect(String((events[0] as { message: string }).message)).toMatch(
      /Anthropic|Claude|недоступ/i,
    );
  });
});
