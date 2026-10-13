import { describe, expect, it, vi } from 'vitest';
import { defaultGodData } from '../src/app/core/models/graph.model';
import { completeOpenAiCompatible } from '../src/app/core/runtime/llm-provider';
import type { ChatContext } from '../src/app/core/utils/compose-context';

describe('OpenAI-compatible regression', () => {
  it('completeOpenAiCompatible идёт через bridge proxy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok from openai' } }],
      }),
    });

    const context: ChatContext = {
      systemPrompt: 'sys',
      userPrompt: 'hi',
      connectedArtifacts: [],
      god: {
        ...defaultGodData(),
        runner: 'openai-compatible',
        model: 'qwen',
        baseUrl: 'http://llm.local/v1',
        apiKey: 'k',
      },
    };

    const text = await completeOpenAiCompatible(context.god, context, fetchImpl as unknown as typeof fetch);
    expect(text).toBe('ok from openai');
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/layercoop-bridge/v1/openai/chat/completions',
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.baseUrl).toBe('http://llm.local/v1');
    expect(body.apiKey).toBe('k');
  });
});
