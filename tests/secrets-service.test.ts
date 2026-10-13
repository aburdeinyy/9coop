import { describe, expect, it, vi } from 'vitest';
import { SecretsService } from '../src/app/core/services/secrets.service';

describe('SecretsService delete + save', () => {
  it('удалённый ключ не возвращается после save/reload', async () => {
    let stored: Record<string, string> = {
      PAT: 'tok',
      CONFLUENCE_BASE_URL: 'https://wiki',
    };

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/v1/secrets') && (!init || init.method === 'GET' || !init.method)) {
        return {
          ok: true,
          json: async () => ({ file: '.env', vars: { ...stored } }),
        };
      }
      if (u.includes('/v1/secrets') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { vars: Record<string, string> };
        stored = { ...body.vars };
        return {
          ok: true,
          json: async () => ({ ok: true, vars: { ...stored } }),
        };
      }
      throw new Error(`unexpected ${u}`);
    });

    const svc = new SecretsService();
    await svc.reload(fetchImpl as unknown as typeof fetch);
    expect(svc.rows().map((r) => r.key).sort()).toEqual(['CONFLUENCE_BASE_URL', 'PAT']);

    const patIndex = svc.rows().findIndex((r) => r.key === 'PAT');
    svc.removeRow(patIndex);
    const ok = await svc.save(fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(stored).toEqual({ CONFLUENCE_BASE_URL: 'https://wiki' });
    expect(svc.rows().map((r) => r.key)).toEqual(['CONFLUENCE_BASE_URL']);
    expect(svc.rows().some((r) => r.key === 'PAT')).toBe(false);
  });

  it('сохранение пустого списка не воскрешает дефолтные PAT', async () => {
    let stored: Record<string, string> = { PAT: 'x' };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/v1/secrets') && init?.method === 'PUT') {
        stored = { ...(JSON.parse(String(init.body)) as { vars: Record<string, string> }).vars };
        return { ok: true, json: async () => ({ ok: true, vars: stored }) };
      }
      return { ok: true, json: async () => ({ file: '.env', vars: { ...stored } }) };
    });

    const svc = new SecretsService();
    await svc.reload(fetchImpl as unknown as typeof fetch);
    svc.removeRow(0);
    await svc.save(fetchImpl as unknown as typeof fetch);
    expect(stored).toEqual({});
    expect(svc.rows()).toEqual([]);
  });
});
