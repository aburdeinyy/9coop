import { describe, expect, it, vi } from 'vitest';
import { defaultGodData } from '../src/app/core/models/graph.model';
import {
  buildChatCompletionsRequest,
  completeOpenAiCompatible,
} from '../src/app/core/runtime/llm-provider';
import type { ChatContext } from '../src/app/core/utils/compose-context';

describe('OpenAI-compatible auth', () => {
  it('buildChatCompletionsRequest тримит apiKey в Bearer', () => {
    const god = {
      ...defaultGodData(),
      runner: 'openai-compatible' as const,
      model: 'deepseek-chat',
      baseUrl: 'https://openwebui.example/api/v1',
      apiKey: '  sk-test  \n',
    };
    const req = buildChatCompletionsRequest(god, {
      systemPrompt: 's',
      userPrompt: 'u',
      connectedArtifacts: [],
      god,
      focusNodeId: 'x',
    });
    expect(req.headers['Authorization']).toBe('Bearer sk-test');
    expect(req.url).toBe('https://openwebui.example/api/v1/chat/completions');
  });

  it('completeOpenAiCompatible идёт через bridge и передаёт apiKeyEnv', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
      }),
    });

    const god = {
      ...defaultGodData(),
      runner: 'openai-compatible' as const,
      model: 'deepseek-chat',
      baseUrl: 'https://openwebui.example/api/v1',
      apiKey: '',
      apiKeyEnv: 'OPEN_WEBUI_TOKEN',
    };
    const context: ChatContext = {
      systemPrompt: 'sys',
      userPrompt: 'hi',
      connectedArtifacts: [],
      god,
      focusNodeId: 'god-2',
    };

    await completeOpenAiCompatible(god, context, fetchImpl as unknown as typeof fetch);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/layercoop-bridge/v1/openai/chat/completions');
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.apiKeyEnv).toBe('OPEN_WEBUI_TOKEN');
    expect(body.baseUrl).toBe('https://openwebui.example/api/v1');
  });

  it('401 даёт понятную ошибку', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    });
    const god = {
      ...defaultGodData(),
      runner: 'openai-compatible' as const,
      model: 'deepseek-chat',
      baseUrl: 'https://openwebui.example/api/v1',
      apiKey: 'sk-x',
    };
    await expect(
      completeOpenAiCompatible(god, {
        systemPrompt: 's',
        userPrompt: 'u',
        connectedArtifacts: [],
        god,
        focusNodeId: 'x',
      }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/401|Unauthorized|API key/i);
  });
});
