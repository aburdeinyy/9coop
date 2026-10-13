import { describe, expect, it } from 'vitest';
import {
  parseDotEnv,
  serializeDotEnv,
  resolveEnvValue,
  applyProcessEnvToMcpServers,
  scrubMcpSecretsInContent,
  SECRET_ENV_HINT,
} from '../src/app/core/utils/dotenv-format';
import { ARTIFACT_GENERATION_GUIDE } from '../src/app/core/utils/layercoop-architecture';

describe('dotenv-format', () => {
  it('parseDotEnv / serializeDotEnv roundtrip', () => {
    const raw = [
      '# Layercoop secrets',
      'PAT=secret-value',
      'CONFLUENCE_BASE_URL=https://wiki.example.com',
      'EMPTY=',
      '',
    ].join('\n');
    const vars = parseDotEnv(raw);
    expect(vars).toEqual({
      PAT: 'secret-value',
      CONFLUENCE_BASE_URL: 'https://wiki.example.com',
      EMPTY: '',
    });
    const again = parseDotEnv(serializeDotEnv(vars));
    expect(again.PAT).toBe('secret-value');
    expect(again.CONFLUENCE_BASE_URL).toBe('https://wiki.example.com');
  });

  it('resolveEnvValue: пусто / ${NAME} → process.env', () => {
    const env = { PAT: 'from-dotenv', OTHER: 'x' };
    expect(resolveEnvValue('', 'PAT', env)).toBe('from-dotenv');
    expect(resolveEnvValue('${PAT}', 'PAT', env)).toBe('from-dotenv');
    expect(resolveEnvValue('$PAT', 'IGNORED', env)).toBe('from-dotenv');
    expect(resolveEnvValue('literal', 'PAT', env)).toBe('literal');
  });

  it('applyProcessEnvToMcpServers подставляет секреты в env MCP', () => {
    const resolved = applyProcessEnvToMcpServers(
      {
        confluence: {
          command: 'npx',
          args: ['-y', 'x'],
          env: { PAT: '', CONFLUENCE_BASE_URL: 'https://wiki.example.com' },
        },
      },
      { PAT: 'tok' },
    );
    expect(resolved.confluence?.env).toEqual({
      PAT: 'tok',
      CONFLUENCE_BASE_URL: 'https://wiki.example.com',
    });
  });

  it('architecture guide запрещает хардкод секретов, указывает .env', () => {
    expect(ARTIFACT_GENERATION_GUIDE).toContain('.env');
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/не хардкод|ЗАПРЕЩЕНО.*секрет|не пиши.*токен/i);
    expect(ARTIFACT_GENERATION_GUIDE).toContain(SECRET_ENV_HINT.slice(0, 20));
  });

  it('scrubMcpSecretsInContent убирает реальные PAT из export', () => {
    const scrubbed = scrubMcpSecretsInContent(
      JSON.stringify({
        mcpServers: {
          confluence: { command: 'npx', env: { PAT: 'real-secret', CONFLUENCE_BASE_URL: 'https://x' } },
        },
      }),
    );
    expect(scrubbed).toContain('${PAT}');
    expect(scrubbed).not.toContain('real-secret');
    expect(scrubbed).toContain('https://x');
  });
});
