import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_STDIN_INSTRUCTION,
  buildClaudeCodeArgs,
  buildSpawnArgs,
  createClaudeCodeState,
  parseClaudeCodeLine,
  quoteWindowsArg,
  resolveClaudeCodeAuth,
} from '../bridge/src/runners/claude-code';
import type { BridgeRunRequest } from '../bridge/src/types';

function req(patch: Partial<BridgeRunRequest> = {}): BridgeRunRequest {
  return { apiKey: '', prompt: 'hi', ...patch };
}

describe('claude-code args', () => {
  it('stream-json + промпт уходит на stdin, не в argv', () => {
    const args = buildClaudeCodeArgs();
    expect(args.slice(0, 2)).toEqual(['-p', CLAUDE_CODE_STDIN_INSTRUCTION]);
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--include-partial-messages');
    expect(args).not.toContain('--bare');
  });

  it('isolated → --bare', () => {
    expect(buildClaudeCodeArgs({ isolated: true })).toContain('--bare');
  });

  it('файлы вместо длинных argv для system prompt и mcp', () => {
    const args = buildClaudeCodeArgs({
      systemPromptFile: '/tmp/sys.txt',
      mcpConfigFile: '/tmp/mcp.json',
    });
    expect(args[args.indexOf('--append-system-prompt-file') + 1]).toBe('/tmp/sys.txt');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/tmp/mcp.json');
  });

  it('в argv попадает только безопасный id модели', () => {
    expect(buildClaudeCodeArgs({ model: 'claude-opus-5' })).toContain('claude-opus-5');
    expect(buildClaudeCodeArgs({ model: 'evil model && rm -rf /' })).not.toContain('--model');
    expect(buildClaudeCodeArgs({ model: '  ' })).not.toContain('--model');
  });

  it('windows: аргументы с пробелами закавычены, обычные — нет', () => {
    expect(quoteWindowsArg('--bare')).toBe('--bare');
    expect(quoteWindowsArg('C:/tmp/a b/sys.txt')).toBe('"C:/tmp/a b/sys.txt"');
    expect(buildSpawnArgs(['-p', 'два слова'], 'win32')).toEqual(['-p', '"два слова"']);
    expect(buildSpawnArgs(['-p', 'два слова'], 'linux')).toEqual(['-p', 'два слова']);
  });
});

describe('claude-code stream-json parsing', () => {
  it('text_delta → token, текст копится в state', () => {
    const state = createClaudeCodeState();
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'При' } },
    });
    expect(parseClaudeCodeLine(line, state)).toEqual([{ type: 'token', text: 'При' }]);
    expect(state.text).toBe('При');
  });

  it('assistant tool_use → start, user tool_result → end с тем же именем', () => {
    const state = createClaudeCodeState();
    const start = parseClaudeCodeLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read' }] },
      }),
      state,
    );
    expect(start).toEqual([{ type: 'tool', name: 'Read', status: 'start', callId: 'tu_1' }]);

    const end = parseClaudeCodeLine(
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1' }] },
      }),
      state,
    );
    expect(end).toEqual([{ type: 'tool', name: 'Read', status: 'end', callId: 'tu_1' }]);
  });

  it('assistant-текст не дублирует уже отданные дельты', () => {
    const state = createClaudeCodeState();
    const events = parseClaudeCodeLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'дубль' }] } }),
      state,
    );
    expect(events).toEqual([]);
  });

  it('result success → done, ошибка → error', () => {
    const ok = createClaudeCodeState();
    expect(
      parseClaudeCodeLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'Готово' }), ok),
    ).toEqual([{ type: 'done', result: 'Готово' }]);

    const bad = createClaudeCodeState();
    expect(
      parseClaudeCodeLine(
        JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Ой' }),
        bad,
      ),
    ).toEqual([{ type: 'error', message: 'Ой' }]);
  });

  it('пустой result подставляет накопленный текст', () => {
    const state = createClaudeCodeState();
    state.text = 'из дельт';
    expect(
      parseClaudeCodeLine(JSON.stringify({ type: 'result', subtype: 'success', result: '' }), state),
    ).toEqual([{ type: 'done', result: 'из дельт' }]);
  });

  it('system/init кладёт сессию и ошибки MCP в state, событий не даёт', () => {
    const state = createClaudeCodeState();
    const events = parseClaudeCodeLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        mcp_servers: [{ name: 'jira', status: 'connected' }],
        mcp_server_errors: [{ name: 'conf', type: 'url_missing_type', message: 'нет type' }],
      }),
      state,
    );
    expect(events).toEqual([]);
    expect(state.sessionId).toBe('sess-1');
    expect(state.mcpServers).toEqual(['jira:connected']);
    expect(state.mcpErrors[0]).toContain('conf');
  });

  it('битые строки игнорируются', () => {
    const state = createClaudeCodeState();
    expect(parseClaudeCodeLine('не json', state)).toEqual([]);
    expect(parseClaudeCodeLine('[1,2]', state)).toEqual([]);
    expect(parseClaudeCodeLine(JSON.stringify({ type: 'system', subtype: 'api_retry' }), state)).toEqual([]);
  });
});

describe('claude-code auth', () => {
  it('без изоляции и без ключа — подписка, ANTHROPIC_API_KEY вычищается', () => {
    const auth = resolveClaudeCodeAuth(req(), { ANTHROPIC_API_KEY: 'sk-from-env' });
    expect(auth.mode).toBe('subscription');
    expect(auth.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(auth.error).toBeUndefined();
  });

  it('ключ на ноде побеждает подписку', () => {
    const auth = resolveClaudeCodeAuth(req({ apiKey: 'sk-node' }), {});
    expect(auth.mode).toBe('api-key');
    expect(auth.env['ANTHROPIC_API_KEY']).toBe('sk-node');
  });

  it('изоляция берёт ключ из окружения, если на ноде пусто', () => {
    const auth = resolveClaudeCodeAuth(req({ isolated: true }), { ANTHROPIC_API_KEY: 'sk-env' });
    expect(auth.error).toBeUndefined();
    expect(auth.env['ANTHROPIC_API_KEY']).toBe('sk-env');
  });

  it('изоляция без ключа — внятная ошибка, а не молчаливый провал', () => {
    const auth = resolveClaudeCodeAuth(req({ isolated: true }), {});
    expect(auth.error).toContain('--bare');
    expect(auth.error).toContain('API key');
  });
});
