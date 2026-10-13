import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CliArgs {
  port: number;
  host: string;
  open: boolean;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let port = Number(process.env.PORT || process.env.LAYERCOOP_PORT || 4200);
  let host = process.env.LAYERCOOP_HOST || '127.0.0.1';
  let open = true;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') help = true;
    else if (a === '--no-open') open = false;
    else if ((a === '--port' || a === '-p') && args[i + 1]) {
      port = Number(args[++i]);
    } else if (a === '--host' && args[i + 1]) {
      host = args[++i]!;
    } else if (/^--port=\d+$/.test(a)) {
      port = Number(a.slice('--port='.length));
    }
  }

  if (!Number.isFinite(port) || port <= 0) port = 4200;
  return { port, host, open, help };
}

/** `/layercoop-bridge/v1/run` → `/v1/run` (как Angular proxy pathRewrite). */
export function rewriteBridgeUrl(urlPath: string): string | null {
  if (urlPath === '/layercoop-bridge' || urlPath === '/layercoop-bridge/') return '/';
  if (!urlPath.startsWith('/layercoop-bridge/')) return null;
  const rest = urlPath.slice('/layercoop-bridge'.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

export function resolvePackageRoot(fromFile = fileURLToPath(import.meta.url)): string {
  // bin/layercoop.mjs → .. ; cli/paths.ts → ..
  const dir = path.dirname(fromFile);
  const parent = path.basename(dir);
  if (parent === 'bin' || parent === 'cli') return path.resolve(dir, '..');
  return path.resolve(dir);
}

export function resolveUiDist(packageRoot: string): string {
  const candidate = path.join(packageRoot, 'dist', 'layercoop', 'browser');
  if (!fs.existsSync(path.join(candidate, 'index.html'))) {
    throw new Error(
      `UI не собран: нет ${candidate}/index.html. В dev: npm run build. В пакете npx — ожидается prepublish build.`,
    );
  }
  return candidate;
}

export function resolveBridgeEntry(packageRoot: string): string {
  return path.join(packageRoot, 'bridge', 'src', 'server.ts');
}
