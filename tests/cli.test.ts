import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseCliArgs,
  resolveBridgeEntry,
  resolvePackageRoot,
  resolveUiDist,
  rewriteBridgeUrl,
} from '../cli/paths';

describe('cli paths / args', () => {
  it('parseCliArgs читает port/host/--no-open', () => {
    expect(parseCliArgs(['node', 'layercoop', '--port', '4321', '--host', '0.0.0.0'])).toEqual({
      port: 4321,
      host: '0.0.0.0',
      open: true,
      help: false,
    });
    expect(parseCliArgs(['node', 'layercoop', '-p', '9', '--no-open']).port).toBe(9);
    expect(parseCliArgs(['node', 'layercoop', '--no-open']).open).toBe(false);
    expect(parseCliArgs(['node', 'layercoop', '--help']).help).toBe(true);
  });

  it('rewriteBridgeUrl снимает префикс /layercoop-bridge', () => {
    expect(rewriteBridgeUrl('/layercoop-bridge/v1/run')).toBe('/v1/run');
    expect(rewriteBridgeUrl('/layercoop-bridge')).toBe('/');
    expect(rewriteBridgeUrl('/layercoop-bridge/')).toBe('/');
    expect(rewriteBridgeUrl('/other')).toBeNull();
  });

  it('resolveUiDist находит dist/layercoop/browser', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layercoop-cli-'));
    const ui = path.join(root, 'dist', 'layercoop', 'browser');
    fs.mkdirSync(ui, { recursive: true });
    fs.writeFileSync(path.join(ui, 'index.html'), '<html></html>');
    expect(resolveUiDist(root)).toBe(ui);
    expect(resolveBridgeEntry(root)).toContain(`${path.sep}bridge${path.sep}src${path.sep}server.ts`);
    expect(resolvePackageRoot(path.join(root, 'bin', 'layercoop.mjs'))).toBe(root);
  });
});
