import http from 'node:http';
import type { AgentRunner, BridgeRunRequest, BridgeSseEvent } from './types';
import { pickRunnerId } from './types';
import { AVAILABLE_RUNNERS, resolveRunner, type RunnerOverrides } from './runners';
import { listCursorModels } from './runners/cursor';
import { envFilePath, readEnvFile, writeEnvFile } from './env-store';
import { runMcpRefresh, type McpRefreshRequest } from './mcp-refresh';
import { proxyOpenAiChatCompletions, proxyOpenAiModels } from './openai-proxy';
import { gitDiff, gitStatus, pickFolderDialog } from './git-workspace';
import { deleteLayercoopArtifacts } from './artifact-fs';

export const DEFAULT_BRIDGE_PORT = 7843;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeSse(res: http.ServerResponse, event: BridgeSseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export interface BridgeServerDeps {
  /** Переопределяет все runner сразу (используется тестами). */
  runAgent?: AgentRunner;
  /** Точечная замена одного runner. */
  runners?: RunnerOverrides;
  cwd?: string;
  listCursorModels?: (apiKey: string) => Promise<unknown>;
  /** Подмена MCP-тика в тестах. По умолчанию — stdio tools/call без LLM. */
  refreshMcp?: (body: McpRefreshRequest, cwd: string) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}

function readBearer(req: http.IncomingMessage): string {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? '';
}

export function createBridgeServer(deps: BridgeServerDeps = {}): http.Server {
  const pickRunner = (runner: unknown): AgentRunner =>
    deps.runAgent ?? resolveRunner(runner, deps.runners ?? {});
  const cwd = deps.cwd ?? process.cwd();

  return http.createServer(async (req, res) => {
    const url = req.url?.split('?')[0] ?? '';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url === '/v1/cursor/models') {
      const apiKey = readBearer(req);
      if (!apiKey) {
        json(res, 401, { error: 'Укажите Cursor API key' });
        return;
      }
      try {
        const models = await (deps.listCursorModels ?? listCursorModels)(apiKey);
        json(res, 200, { models });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 502, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url === '/health') {
      json(res, 200, {
        ok: true,
        runtime: 'local-cursor-sdk',
        runners: AVAILABLE_RUNNERS,
      });
      return;
    }

    if (req.method === 'GET' && url === '/v1/secrets') {
      json(res, 200, {
        path: envFilePath(cwd),
        file: '.env',
        vars: readEnvFile(cwd),
      });
      return;
    }

    if (req.method === 'PUT' && url === '/v1/secrets') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { vars?: Record<string, unknown> };
        if (!body.vars || typeof body.vars !== 'object' || Array.isArray(body.vars)) {
          json(res, 400, { error: 'Body must be { vars: Record<string,string> }' });
          return;
        }
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.vars)) {
          if (!k.trim()) continue;
          if (typeof v === 'string') vars[k.trim()] = v;
          else if (v == null) vars[k.trim()] = '';
          else vars[k.trim()] = String(v);
        }
        writeEnvFile(vars, cwd);
        json(res, 200, { ok: true, path: envFilePath(cwd), vars });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/mcp/refresh') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as McpRefreshRequest;
        if (!body || typeof body.source !== 'string' || typeof body.server !== 'string' || typeof body.artifactContent !== 'string') {
          json(res, 400, { error: 'Body must include artifactContent, server, source' });
          return;
        }
        const view = await (deps.refreshMcp ?? runMcpRefresh)(body, cwd);
        json(res, 200, { view });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 502, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/openai/chat/completions') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as Record<string, unknown>;
        const runCwd =
          typeof body['cwd'] === 'string' && body['cwd'].trim() ? body['cwd'].trim() : cwd;
        const result = await proxyOpenAiChatCompletions(body, runCwd, deps.fetchImpl ?? fetch);
        json(res, result.status, result.json);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: { message } });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/git/status') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { path?: string };
        const result = await gitStatus(body.path ?? '');
        json(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/git/diff') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { path?: string; file?: string };
        const result = await gitDiff(body.path ?? '', body.file ?? '');
        json(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/git/pick-folder') {
      try {
        const result = await pickFolderDialog();
        json(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/fs/delete-artifacts') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cwd?: string; paths?: string[] };
        const targetCwd =
          typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : cwd;
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
        const result = deleteLayercoopArtifacts(targetCwd, paths);
        json(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/openai/models') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as Record<string, unknown>;
        const result = await proxyOpenAiModels(body, cwd, deps.fetchImpl ?? fetch);
        json(res, result.status, result.json);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { error: { message } });
      }
      return;
    }

    if (req.method === 'POST' && url === '/v1/run') {
      let body: BridgeRunRequest;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw) as BridgeRunRequest;
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        const runAgent = pickRunner(pickRunnerId(body));
        for await (const event of runAgent({ ...body, cwd: body.cwd ?? cwd })) {
          writeSse(res, event);
          if (event.type === 'done' || event.type === 'error') break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeSse(res, { type: 'error', message });
      }
      res.end();
      return;
    }

    json(res, 404, { error: 'Not found' });
  });
}

export function startBridgeServer(
  port = Number(process.env.LAYERCOOP_BRIDGE_PORT || DEFAULT_BRIDGE_PORT),
  deps?: BridgeServerDeps,
): http.Server {
  const server = createBridgeServer(deps);
  server.listen(port, '127.0.0.1', () => {
    console.log(
      `[layercoop-bridge] http://127.0.0.1:${port} — runners: ${AVAILABLE_RUNNERS.join(', ')}`,
    );
  });
  return server;
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMain) {
  startBridgeServer();
}
