import { describe, expect, it, vi } from 'vitest';
import {
  encodeMcpToolName,
  decodeMcpToolName,
  toOpenAiTools,
  extractToolCalls,
  runOpenAiToolLoop,
  type McpToolDescriptor,
} from '../bridge/src/openai-tool-loop';
import { resolveProxyApiKey } from '../bridge/src/openai-proxy';
import { completeOpenAiCompatible } from '../src/app/core/runtime/llm-provider';
import { defaultGodData } from '../src/app/core/models/graph.model';
import type { ChatContext } from '../src/app/core/utils/compose-context';

describe('mcp tool name mangling', () => {
  it('server__tool ↔ roundtrip', () => {
    expect(encodeMcpToolName('jira', 'jira_search')).toBe('jira__jira_search');
    expect(decodeMcpToolName('jira__jira_search')).toEqual({
      server: 'jira',
      tool: 'jira_search',
    });
    expect(decodeMcpToolName('bad')).toBeNull();
  });

  it('toOpenAiTools строит function tools', () => {
    const tools = toOpenAiTools([
      {
        server: 'jira',
        name: 'jira_search',
        description: 'search',
        inputSchema: { type: 'object', properties: { jql: { type: 'string' } } },
      },
    ]);
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'jira__jira_search',
          description: 'search',
          parameters: { type: 'object', properties: { jql: { type: 'string' } } },
        },
      },
    ]);
  });
});

describe('extractToolCalls', () => {
  it('читает choices[0].message.tool_calls', () => {
    const calls = extractToolCalls({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'jira__jira_search', arguments: '{"jql":"a"}' },
              },
            ],
          },
        },
      ],
    });
    expect(calls).toEqual([
      { id: 'c1', name: 'jira__jira_search', arguments: { jql: 'a' } },
    ]);
  });

  it('пустой ответ → []', () => {
    expect(extractToolCalls({ choices: [{ message: { content: 'hi' } }] })).toEqual([]);
  });
});

describe('runOpenAiToolLoop', () => {
  it('один round tool_calls → tools/call → финальный content', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'jira__jira_search',
                      arguments: '{"jql":"assignee=currentUser()"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Найдено 2 задачи' } }],
        }),
      });

    const callTool = vi.fn().mockResolvedValue({ issues: ['A-1', 'A-2'] });
    const listTools = vi.fn().mockResolvedValue([
      {
        server: 'jira',
        name: 'jira_search',
        description: 'search jira',
        inputSchema: { type: 'object' },
      } satisfies McpToolDescriptor,
    ]);

    const result = await runOpenAiToolLoop({
      url: 'https://llm.example/v1/chat/completions',
      apiKey: 'sk',
      model: 'deepseek',
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'мои задачи' },
      ],
      mcpServers: {
        jira: { type: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'] },
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      listTools,
      callTool,
    });

    expect(result.status).toBe(200);
    expect((result.json as { choices: Array<{ message: { content: string } }> }).choices[0]
      .message.content).toBe('Найдено 2 задачи');
    expect(listTools).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith(
      'jira',
      'jira_search',
      { jql: 'assignee=currentUser()' },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(secondBody.messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
    });
    expect(secondBody.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'jira__jira_search' }),
        }),
      ]),
    );
  });

  it('без mcpServers — один запрос без tools', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
      }),
    });
    const result = await runOpenAiToolLoop({
      url: 'https://llm.example/v1/chat/completions',
      apiKey: 'sk',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      mcpServers: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      listTools: vi.fn(),
      callTool: vi.fn(),
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.tools).toBeUndefined();
  });
});

describe('completeOpenAiCompatible mcpServers', () => {
  it('передаёт mcpServers в bridge proxy body', async () => {
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
      apiKey: 'sk-x',
    };
    const context: ChatContext = {
      systemPrompt: 'sys',
      userPrompt: 'hi',
      connectedArtifacts: [
        {
          id: 'mcp-1',
          kind: 'mcp',
          label: 'Jira',
          prompt: 'jira',
          artifactContent: JSON.stringify({
            mcpServers: {
              jira: { command: 'npx', args: ['-y', 'jira'] },
            },
          }),
        },
      ],
      god,
      focusNodeId: 'god-2',
    };
    await completeOpenAiCompatible(god, context, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.mcpServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'jira', command: 'npx' }),
      ]),
    );
    expect(body.useDiskMcp).toBe(true);
  });
});

describe('proxy still resolves api key', () => {
  it('resolveProxyApiKey не регрессирует', () => {
    expect(resolveProxyApiKey('  a  ', undefined, process.cwd())).toBe('a');
  });
});
