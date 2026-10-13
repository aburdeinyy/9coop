import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { SdkMcpServersRecord } from '../../src/app/core/runtime/mcp-servers';
import type { McpToolDescriptor } from './openai-tool-loop';

function encodeMessage(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]);
}

function readFrames(chunk: Buffer, pending: { buf: Buffer }): unknown[] {
  pending.buf = Buffer.concat([pending.buf, chunk]);
  const out: unknown[] = [];
  while (true) {
    const headerEnd = pending.buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = pending.buf.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (pending.buf.length < start + len) break;
    const body = pending.buf.subarray(start, start + len).toString('utf8');
    pending.buf = pending.buf.subarray(start + len);
    out.push(JSON.parse(body));
  }
  return out;
}

function unwrapToolPayload(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;
  const text = content
    .filter((part): part is { type: string; text: string } => {
      return !!part && typeof part === 'object' && (part as { type?: string }).type === 'text';
    })
    .map((part) => part.text)
    .join('\n');
  if (!text.trim()) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Минимальный stdio tools/call (для mcp-refresh / простых fake-серверов).
 * Для corp MCP (@atlassian-dc-mcp/…) используй callToolOnMcpServers (официальный SDK).
 */
export function callStdioMcpTool(
  command: string,
  args: string[],
  env: Record<string, string>,
  tool: string,
  toolArgs: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = { buf: Buffer.alloc(0) };
    let nextId = 1;
    const waiters = new Map<number, (msg: Record<string, unknown>) => void>();
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error('MCP refresh timeout')), timeoutMs);

    const send = (method: string, params: unknown, note = false) => {
      const id = note ? undefined : nextId++;
      const msg = note
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id, method, params };
      child.stdin.write(encodeMessage(msg));
      if (id == null) return Promise.resolve({});
      return new Promise<Record<string, unknown>>((res) => waiters.set(id, res));
    };

    child.stdout.on('data', (chunk: Buffer) => {
      let frames: unknown[] = [];
      try {
        frames = readFrames(chunk, pending);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      for (const frame of frames) {
        if (!frame || typeof frame !== 'object') continue;
        const msg = frame as Record<string, unknown>;
        const id = typeof msg['id'] === 'number' ? msg['id'] : null;
        if (id == null) continue;
        const waiter = waiters.get(id);
        if (waiter) {
          waiters.delete(id);
          waiter(msg);
        }
      }
    });

    child.on('error', (err) => fail(err));
    child.on('exit', (code) => {
      if (!settled) fail(new Error(`MCP завершился с кодом ${code ?? '?'}`));
    });

    void (async () => {
      try {
        const init = await send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'layercoop', version: '0.1.0' },
        });
        if (init['error']) throw new Error('MCP initialize failed');
        await send('notifications/initialized', {}, true);
        const called = await send('tools/call', { name: tool, arguments: toolArgs });
        if (called['error']) throw new Error('MCP tools/call failed');
        const result = called['result'] as { isError?: boolean } | undefined;
        if (result?.isError) throw new Error('MCP tool вернул ошибку');
        settled = true;
        clearTimeout(timer);
        child.kill();
        resolve(unwrapToolPayload(called['result']));
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}

function stdioEnv(cfg: SdkMcpServersRecord[string]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  if (cfg.env && typeof cfg.env === 'object') {
    for (const [k, v] of Object.entries(cfg.env)) {
      if (typeof v === 'string') env[k] = v;
    }
  }
  return env;
}

async function withSdkClient<T>(
  command: string,
  args: string[],
  env: Record<string, string>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command,
    args,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'layercoop', version: '0.1.0' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

/** tools/list через официальный MCP SDK (нужен для corp Jira/Confluence). */
export function listStdioMcpTools(
  command: string,
  args: string[],
  env: Record<string, string>,
  server: string,
): Promise<McpToolDescriptor[]> {
  return withSdkClient(command, args, env, async (client) => {
    const listed = await client.listTools();
    const out: McpToolDescriptor[] = [];
    for (const raw of listed.tools ?? []) {
      if (!raw.name?.trim()) continue;
      const desc: McpToolDescriptor = {
        server,
        name: raw.name.trim(),
      };
      if (raw.description?.trim()) desc.description = raw.description.trim();
      if (raw.inputSchema && typeof raw.inputSchema === 'object') {
        desc.inputSchema = raw.inputSchema as Record<string, unknown>;
      }
      out.push(desc);
    }
    return out;
  });
}

/** Список tools со всех stdio-серверов; http/sse пропускаются. */
export async function listToolsFromMcpServers(
  servers: SdkMcpServersRecord,
  listImpl: typeof listStdioMcpTools = listStdioMcpTools,
): Promise<McpToolDescriptor[]> {
  const entries = Object.entries(servers).filter(([, cfg]) => {
    if (!cfg.command?.trim()) return false;
    if (cfg.type && cfg.type !== 'stdio') return false;
    return true;
  });

  const settled = await Promise.allSettled(
    entries.map(([name, cfg]) => listImpl(cfg.command!, cfg.args ?? [], stdioEnv(cfg), name)),
  );

  const out: McpToolDescriptor[] = [];
  settled.forEach((result, i) => {
    const name = entries[i]?.[0] ?? '?';
    if (result.status === 'fulfilled') {
      out.push(...result.value);
      return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.warn(`[layercoop-bridge] MCP tools/list «${name}» failed: ${reason}`);
  });
  return out;
}

export async function callToolOnMcpServers(
  servers: SdkMcpServersRecord,
  server: string,
  tool: string,
  toolArgs: Record<string, unknown>,
): Promise<unknown> {
  const cfg = servers[server];
  if (!cfg?.command?.trim()) {
    throw new Error(`MCP server «${server}» не найден или не stdio`);
  }
  if (cfg.type && cfg.type !== 'stdio') {
    throw new Error(`MCP server «${server}»: http/sse в tool-loop пока не поддерживаются`);
  }
  return withSdkClient(cfg.command, cfg.args ?? [], stdioEnv(cfg), async (client) => {
    const result = await client.callTool({ name: tool, arguments: toolArgs });
    if (result.isError) throw new Error('MCP tool вернул ошибку');
    return unwrapToolPayload(result);
  });
}
