import { describe, expect, it } from 'vitest';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import {
  GOD_NODE_ID,
  defaultGodData,
  isGodData,
  normalizeGodData,
} from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';
import {
  applyRunnerPreset,
  chatCompletionsUrl,
  fetchCursorModels,
  fetchOpenAiCompatibleModels,
  modelsListUrl,
  parseChatCompletionsContent,
  stripGodSecrets,
} from '../src/app/core/runtime/llm-provider';
import { runRuntime } from '../src/app/core/runtime/runtime-engine';
import { buildExportBundle } from '../src/app/core/utils/export-artifacts';

const noopDelay = async () => undefined;

function graphWithGod(data: GraphNode['data']): LayercoopGraph {
  return {
    version: 1,
    name: 'demo',
    updatedAt: '2026-09-03T00:00:00.000Z',
    nodes: [
      { id: GOD_NODE_ID, type: 'god', position: { x: 0, y: 0 }, data },
    ],
    edges: [],
  };
}

describe('GodNodeData', () => {
  it('default — Cursor (local) без ключа', () => {
    const god = defaultGodData();
    expect(god.runner).toBe('cursor');
    expect(god.model).toBe('auto');
    expect(god.apiKey).toBe('');
    expect(isGodData(god)).toBe(true);
  });

  it('normalizeGodData дополняет старый { label } и мигрирует preview', () => {
    const god = normalizeGodData({ label: 'Cursor' });
    expect(god.runner).toBe('cursor');
    expect(god.label).toBe('Cursor');
    expect(normalizeGodData({ label: 'X', runner: 'preview' as never, model: 'local-preview' }).runner).toBe(
      'cursor',
    );
  });

  it('applyRunnerPreset ставит URL и модель OpenAI, ключ не трогает', () => {
    const next = applyRunnerPreset(
      { ...defaultGodData(), apiKey: 'sk-keep' },
      'openai',
    );
    expect(next.runner).toBe('openai');
    expect(next.baseUrl).toBe('https://api.openai.com/v1');
    expect(next.model).toContain('gpt');
    expect(next.apiKey).toBe('sk-keep');
  });
});

describe('llm-provider helpers', () => {
  it('chatCompletionsUrl клеит /chat/completions', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(chatCompletionsUrl('http://localhost:11434/v1/')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://x/v1/chat/completions')).toBe(
      'https://x/v1/chat/completions',
    );
  });

  it('modelsListUrl клеит /models', () => {
    expect(modelsListUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models');
    expect(modelsListUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/models');
    expect(modelsListUrl('https://x/v1/chat/completions')).toBe('https://x/v1/models');
    expect(modelsListUrl('')).toBe('');
  });

  it('fetchOpenAiCompatibleModels идёт через bridge и читает data[].id', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('/layercoop-bridge/v1/openai/models');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
      });
      return new Response(
        JSON.stringify({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4o' }, { id: 'gpt-4.1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const models = await fetchOpenAiCompatibleModels(
      'https://api.openai.com/v1',
      'sk-test',
      { fetchImpl },
    );
    expect(models).toEqual(['gpt-4.1', 'gpt-4o']);
  });

  it('fetchOpenAiCompatibleModels пробрасывает HTTP ошибку', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Unauthorized (401)' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(
      fetchOpenAiCompatibleModels('https://api.openai.com/v1', '', { fetchImpl }),
    ).rejects.toThrow(/401/);
  });

  it('fetchCursorModels ходит в bridge /v1/cursor/models с Bearer', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('/layercoop-bridge/v1/cursor/models');
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer cursor_test');
      return new Response(
        JSON.stringify({
          models: [
            {
              id: 'grok-4.6',
              displayName: 'Grok 4.6',
              variants: [
                {
                  displayName: 'Grok 4.6 High',
                  params: [{ id: 'thinking', value: 'high' }],
                  isDefault: true,
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const models = await fetchCursorModels('cursor_test', { fetchImpl });
    expect(models).toMatchObject([{ id: 'grok-4.6', label: 'Grok 4.6' }]);
  });

  it('parseChatCompletionsContent читает choices[0].message.content', () => {
    expect(
      parseChatCompletionsContent({
        choices: [{ message: { content: 'привет' } }],
      }),
    ).toBe('привет');
  });

  it('stripGodSecrets убирает apiKey', () => {
    const stripped = stripGodSecrets({
      ...defaultGodData(),
      apiKey: 'sk-secret',
    });
    expect(stripped.apiKey).toBe('');
  });
});

describe('GraphService.updateGodConfig', () => {
  it('меняет runner и модель GOD-ноды', () => {
    const service = new GraphService();
    service.updateGodConfig({ runner: 'openai-compatible', model: 'qwen', baseUrl: 'http://llm' });
    const god = service.graph().nodes.find((n) => n.id === GOD_NODE_ID);
    expect(isGodData(god!.data)).toBe(true);
    if (!isGodData(god!.data)) return;
    expect(god!.data.runner).toBe('openai-compatible');
    expect(god!.data.model).toBe('qwen');
    expect(god!.data.baseUrl).toBe('http://llm');
  });
});

describe('export + runtime с конфигом GOD', () => {
  it('не кладёт apiKey в layercoop.graph.json', () => {
    const bundle = buildExportBundle(
      graphWithGod({ ...defaultGodData(), apiKey: 'sk-secret' }),
    );
    const file = bundle.files.find((f) => f.path === '.layercoop/graph.json');
    expect(file?.content).not.toContain('sk-secret');
  });

  it('runRuntime вызывает injected complete', async () => {
    const events = [];
    for await (const event of runRuntime(
      graphWithGod(defaultGodData()),
      'hello',
      {
        delay: noopDelay,
        complete: async () => 'from-llm',
      },
    )) {
      events.push(event);
    }
    const text = events
      .filter((e) => e.type === 'token')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('from-llm');
  });
});

describe('GOD label follows runner', () => {
  it('дефолтное имя меняется вместе с runner, пользовательское — нет', () => {
    const god = applyRunnerPreset(defaultGodData(), 'opencode');
    expect(god.label).toBe('opencode');
    expect(applyRunnerPreset(god, 'claude-code').label).toBe('Claude Code');
    expect(applyRunnerPreset({ ...god, label: 'Мой GOD' }, 'cursor').label).toBe('Мой GOD');
  });

  it('старый граф с label «Cursor» и другим runner мигрирует', () => {
    expect(normalizeGodData({ label: 'Cursor', runner: 'opencode' }).label).toBe('opencode');
    expect(normalizeGodData({ label: 'Cursor', runner: 'cursor' }).label).toBe('Cursor');
  });
});
