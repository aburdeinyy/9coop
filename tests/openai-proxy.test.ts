import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createBridgeServer } from '../bridge/src/server';
import { resolveProxyApiKey } from '../bridge/src/openai-proxy';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

describe('openai proxy', () => {
  it('resolveProxyApiKey тримит прямой ключ и читает .env по apiKeyEnv', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'owui-key-'));
    try {
      fs.writeFileSync(path.join(cwd, '.env'), 'OPEN_WEBUI_TOKEN=sk-from-env\n', 'utf8');
      expect(resolveProxyApiKey('  sk-direct  ', 'OPEN_WEBUI_TOKEN', cwd)).toBe('sk-direct');
      expect(resolveProxyApiKey('', 'OPEN_WEBUI_TOKEN', cwd)).toBe('sk-from-env');
      expect(resolveProxyApiKey('', 'MISSING', cwd)).toBe('');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('POST /v1/openai/chat/completions проксирует с Bearer и тримом', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    });
    const server = createBridgeServer({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runAgent: async function* () {
        yield { type: 'done', result: '' };
      },
    });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/openai/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://openwebui.example/api/v1',
          model: 'deepseek-chat',
          temperature: 0.1,
          messages: [{ role: 'user', content: 'ping' }],
          apiKey: '  sk-test  ',
        }),
      });
      expect(res.status).toBe(200);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
        'https://openwebui.example/api/v1/chat/completions',
      );
      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    } finally {
      server.close();
    }
  });

  it('401 от upstream возвращает понятный hint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid API key' }),
    });
    const server = createBridgeServer({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runAgent: async function* () {
        yield { type: 'done', result: '' };
      },
    });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/openai/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://openwebui.example/api/v1',
          model: 'm',
          messages: [],
          apiKey: 'bad',
        }),
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: { message: string } };
      expect(json.error.message).toMatch(/401|API key|openwebui/i);
    } finally {
      server.close();
    }
  });
});
