import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseCliArgs,
  resolveBridgeEntry,
  resolvePackageRoot,
  resolveUiDist,
  rewriteBridgeUrl,
} from './paths';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function sendFile(res: http.ServerResponse, file: string): void {
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': contentType(file) });
  res.end(body);
}

function proxyHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: URL,
  transport: typeof http | typeof https,
): void {
  const headers = { ...req.headers, host: target.host };
  delete headers['connection'];
  const upstream = transport.request(
    target,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
  req.pipe(upstream);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

async function waitForBridge(port: number, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else reject(new Error('bad status'));
        });
        req.on('error', reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Bridge не поднялся на :${port}`);
}

export async function main(argv = process.argv): Promise<void> {
  const opts = parseCliArgs(argv);
  if (opts.help) {
    console.log(`Usage: layercoop [--port 4200] [--host 127.0.0.1] [--no-open]

Starts Layercoop UI + local bridge (MCP / runners).`);
    return;
  }

  const root = resolvePackageRoot(fileURLToPath(import.meta.url));
  const uiRoot = resolveUiDist(root);
  const bridgeEntry = resolveBridgeEntry(root);
  const bridgePort = Number(process.env.LAYERCOOP_BRIDGE_PORT) || (await freePort());

  const bridge = spawn(process.execPath, ['--import', 'tsx', bridgeEntry], {
    cwd: process.cwd(),
    env: { ...process.env, LAYERCOOP_BRIDGE_PORT: String(bridgePort) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const shutdown = () => {
    if (!bridge.killed) bridge.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  bridge.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[layercoop] bridge exited with code ${code}`);
      process.exit(code);
    }
  });

  await waitForBridge(bridgePort);

  const uiRootResolved = path.resolve(uiRoot);
  const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] || '/';
    const qs = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';

    const bridgePath = rewriteBridgeUrl(pathname);
    if (bridgePath != null) {
      proxyHttp(
        req,
        res,
        new URL(bridgePath + qs, `http://127.0.0.1:${bridgePort}`),
        http,
      );
      return;
    }

    if (pathname === '/cursor-api' || pathname.startsWith('/cursor-api/')) {
      const rest = pathname.slice('/cursor-api'.length) || '/';
      proxyHttp(req, res, new URL(rest + qs, 'https://api.cursor.com'), https);
      return;
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(uiRootResolved, rel);
    if (!filePath.startsWith(uiRootResolved + path.sep) && filePath !== uiRootResolved) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
    sendFile(res, path.join(uiRootResolved, 'index.html'));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port, opts.host, () => resolve());
    server.on('error', reject);
  });

  const url = `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${opts.port}`;
  console.log(`[layercoop] UI ${url}`);
  console.log(`[layercoop] bridge http://127.0.0.1:${bridgePort}`);
  if (opts.open) openBrowser(url);
}

const entry = process.argv[1] ? path.basename(process.argv[1]) : '';
if (entry === 'main.ts' || process.argv[1]?.endsWith(`${path.sep}cli${path.sep}main.ts`)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
