import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBridgeServer } from '../bridge/src/server';
import type { BridgeSseEvent } from '../bridge/src/types';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

describe('layercoop bridge', () => {
  it('GET /health', async () => {
    const server = createBridgeServer({
      runAgent: async function* () {
        yield { type: 'done', result: '' };
      },
    });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.ok).toBe(true);
      await expect(res.json()).resolves.toMatchObject({ ok: true, runtime: 'local-cursor-sdk' });
    } finally {
      server.close();
    }
  });

  it('GET/PUT /v1/secrets пишет .env', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'layercoop-env-'));
    const server = createBridgeServer({
      cwd,
      runAgent: async function* () {
        yield { type: 'done', result: '' };
      },
    });
    const port = await listen(server);
    try {
      const put = await fetch(`http://127.0.0.1:${port}/v1/secrets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: { PAT: 'tok', CONFLUENCE_BASE_URL: 'https://wiki' } }),
      });
      expect(put.ok).toBe(true);
      const envPath = path.join(cwd, '.env');
      expect(fs.existsSync(envPath)).toBe(true);
      expect(fs.readFileSync(envPath, 'utf8')).toContain('PAT=tok');

      const get = await fetch(`http://127.0.0.1:${port}/v1/secrets`);
      const json = (await get.json()) as { vars: Record<string, string> };
      expect(json.vars.PAT).toBe('tok');
    } finally {
      server.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('POST /v1/run стримит SSE token/tool/done', async () => {
    const runAgent = vi.fn(async function* (): AsyncGenerator<BridgeSseEvent> {
      yield { type: 'token', text: 'Hi' };
      yield { type: 'tool', name: 'jira_search', status: 'start' };
      yield { type: 'tool', name: 'jira_search', status: 'end' };
      yield { type: 'token', text: ' there' };
      yield { type: 'done', result: 'Hi there' };
    });

    const server = createBridgeServer({ runAgent });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'k',
          model: 'composer-2.5',
          prompt: 'hello',
          systemContext: 'sys',
          mcpServers: [{ name: 'jira', type: 'http', url: 'https://x' }],
        }),
      });
      expect(res.ok).toBe(true);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('data: {"type":"token","text":"Hi"}');
      expect(text).toContain('"type":"tool"');
      expect(text).toContain('"type":"done"');
      expect(runAgent).toHaveBeenCalledOnce();
      expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
        apiKey: 'k',
        prompt: 'hello',
        systemContext: 'sys',
      });
    } finally {
      server.close();
    }
  });

  it('GET /v1/cursor/models без ключа — 401', async () => {
    const server = createBridgeServer({
      runAgent: async function* () {
        yield { type: 'done', result: '' };
      },
    });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/cursor/models`);
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('GET /v1/cursor/models отдаёт каталог SDK', async () => {
    const listCursorModels = vi.fn(async (apiKey: string) => {
      expect(apiKey).toBe('cursor_live');
      return [
        { id: 'auto', label: 'Auto' },
        { id: 'grok-4.6', label: 'Grok 4.6' },
      ];
    });
    const server = createBridgeServer({ listCursorModels });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/cursor/models`, {
        headers: { Authorization: 'Bearer cursor_live' },
      });
      expect(res.ok).toBe(true);
      await expect(res.json()).resolves.toEqual({
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'grok-4.6', label: 'Grok 4.6' },
        ],
      });
    } finally {
      server.close();
    }
  });

  it('POST /v1/mcp/refresh не зовёт runner LLM', async () => {
    const runAgent = vi.fn(async function* (): AsyncGenerator<BridgeSseEvent> {
      yield { type: 'done', result: 'llm' };
    });
    const server = createBridgeServer({
      runAgent,
      refreshMcp: async () => ({
        type: 'list',
        title: 'MR',
        items: [{ text: 'Fix' }],
      }),
    });
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/mcp/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactContent: '{}',
          server: 'gitlab',
          source: 'return { type: "list", items: [{ text: "Fix" }] };',
        }),
      });
      expect(res.ok).toBe(true);
      await expect(res.json()).resolves.toMatchObject({ view: { type: 'list' } });
      expect(runAgent).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
