import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callStdioMcpTool, runMcpRefresh } from '../bridge/src/mcp-refresh';
import { buildLayercoopRefreshSource } from '../src/app/core/utils/auto-refresh';

const FAKE_MCP = `
const { stdin, stdout } = process;
let buf = Buffer.alloc(0);
stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const headerEnd = buf.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) break;
    const header = buf.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) break;
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const msg = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    buf = buf.subarray(start + len);
    if (!msg.id) continue;
    const result = msg.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '0' } }
      : { content: [{ type: 'text', text: JSON.stringify([{ title: 'MR-1', web_url: 'https://gitlab.example/1', state: 'opened' }]) }] };
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
    stdout.write(body);
  }
});
`;

describe('stdio MCP refresh', () => {
  it('tools/call возвращает данные без LLM', async () => {
    const file = path.join(os.tmpdir(), `layercoop-fake-mcp-${process.pid}.mjs`);
    fs.writeFileSync(file, FAKE_MCP);
    try {
      const payload = await callStdioMcpTool(process.execPath, [file], {}, 'refresh', {});
      expect(payload).toEqual([
        { title: 'MR-1', web_url: 'https://gitlab.example/1', state: 'opened' },
      ]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('runMcpRefresh собирает view из stdio-сервера', async () => {
    const file = path.join(os.tmpdir(), `layercoop-fake-mcp-run-${process.pid}.mjs`);
    fs.writeFileSync(file, FAKE_MCP);
    const artifactContent = JSON.stringify({
      mcpServers: { gitlab: { command: process.execPath, args: [file] } },
    });
    try {
      const view = await runMcpRefresh(
        {
          artifactContent,
          server: 'gitlab',
          source: buildLayercoopRefreshSource('MR', 'refresh'),
        },
        os.tmpdir(),
      );
      expect(view).toMatchObject({
        type: 'list',
        title: 'MR',
        items: [{ text: 'MR-1', href: 'https://gitlab.example/1' }],
      });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
