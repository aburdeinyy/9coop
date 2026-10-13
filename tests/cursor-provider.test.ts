import { describe, expect, it, vi } from 'vitest';
import { defaultGodData } from '../src/app/core/models/graph.model';
import {
  BRIDGE_OFFLINE_HINT,
  bridgeBase,
  buildCursorBridgeRunBody,
  buildCursorMcpServers,
  checkBridgeHealth,
  completeCursorLocal,
  parseBridgeSseChunk,
} from '../src/app/core/runtime/llm-provider';
import type { ChatContext } from '../src/app/core/utils/compose-context';

const context: ChatContext = {
  systemPrompt: 'system',
  userPrompt: 'hello cursor',
  connectedArtifacts: [],
  god: { ...defaultGodData(), runner: 'cursor', apiKey: 'key_test', model: 'composer-2.5' },
};

describe('Cursor local bridge provider', () => {
  it('bridgeBase: default /layercoop-bridge, игнор старого /cursor-api', () => {
    expect(bridgeBase({ ...defaultGodData(), baseUrl: '' })).toBe('/layercoop-bridge');
    expect(bridgeBase({ ...defaultGodData(), baseUrl: '/cursor-api' })).toBe('/layercoop-bridge');
    expect(bridgeBase({ ...defaultGodData(), baseUrl: 'http://127.0.0.1:7843' })).toBe(
      'http://127.0.0.1:7843',
    );
  });

  it('buildCursorBridgeRunBody + mcp с графа', () => {
    const withMcp: ChatContext = {
      ...context,
      connectedArtifacts: [
        {
          id: 'mcp-1',
          kind: 'mcp',
          label: 'GitHub',
          prompt: 'gh',
          artifactContent: JSON.stringify({
            mcpServers: {
              github: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
                env: { GITHUB_TOKEN: 't' },
              },
            },
          }),
        },
      ],
    };
    expect(buildCursorMcpServers(withMcp)).toHaveLength(1);
    const body = buildCursorBridgeRunBody(context.god, withMcp);
    expect(body.prompt).toBe('hello cursor');
    expect(body.systemContext).toBe('system');
    expect(body.mcpServers).toHaveLength(1);
    expect(body.apiKey).toBe('key_test');
  });

  it('parseBridgeSseChunk', () => {
    const events = parseBridgeSseChunk(
      'data: {"type":"token","text":"Hi"}\n\ndata: {"type":"done","result":"Hi"}\n\n',
    );
    expect(events).toEqual([
      { type: 'token', text: 'Hi' },
      { type: 'done', result: 'Hi' },
    ]);
  });

  it('completeCursorLocal читает SSE с bridge, не Cloud Agents', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      text: async () =>
        [
          'data: {"type":"token","text":"ответ"}',
          'data: {"type":"tool","name":"jira","status":"start"}',
          'data: {"type":"tool","name":"jira","status":"end"}',
          'data: {"type":"done","result":"ответ от cursor"}',
        ].join('\n\n') + '\n\n',
    });

    const tools: string[] = [];
    const text = await completeCursorLocal(context.god, context, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (e) => {
        if (e.type === 'tool') tools.push(`${e.name}:${e.status}`);
      },
    });

    expect(text).toBe('ответ от cursor');
    expect(tools).toEqual(['jira:start', 'jira:end']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/layercoop-bridge/v1/run');
    expect(String(url)).not.toContain('/v1/agents');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('completeCursorLocal при сетевой ошибке — подсказка npm run bridge', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      completeCursorLocal(context.god, context, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(BRIDGE_OFFLINE_HINT);
  });

  it('checkBridgeHealth', async () => {
    const ok = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await expect(checkBridgeHealth('/layercoop-bridge', ok as unknown as typeof fetch)).resolves.toBe(
      true,
    );

    const down = vi.fn().mockRejectedValue(new Error('down'));
    await expect(
      checkBridgeHealth('/layercoop-bridge', down as unknown as typeof fetch),
    ).resolves.toBe(false);
  });
});
