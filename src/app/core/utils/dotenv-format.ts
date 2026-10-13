/** Shared .env helpers (UI docs + bridge). */

export const ENV_FILE_NAME = '.env';

export const SECRET_ENV_HINT =
  'Секреты только в корневом `.env` (UI: Secrets / bridge). В skills и mcp JSON — имена переменных (`PAT`, `CONFLUENCE_TOKEN`), значения никогда не хардкодить.';

export function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function serializeDotEnv(vars: Record<string, string>): string {
  const lines = [
    '# Layercoop secrets — не коммитить. Редактируется в UI (Secrets) или вручную.',
    '# MCP/skills ссылаются только на имена переменных.',
    '',
  ];
  for (const key of Object.keys(vars).sort((a, b) => a.localeCompare(b))) {
    const value = vars[key] ?? '';
    const needsQuote = /[\s#"']/.test(value);
    lines.push(`${key}=${needsQuote ? JSON.stringify(value) : value}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function resolveEnvValue(
  raw: string,
  key: string,
  processEnv: Record<string, string | undefined>,
): string {
  const trimmed = raw.trim();
  const ref =
    trimmed.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1] ??
    trimmed.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  if (!trimmed || ref) {
    const name = ref || key;
    return processEnv[name] ?? '';
  }
  return raw;
}

export function applyProcessEnvToMcpServers<
  T extends Record<string, { env?: Record<string, string>; [k: string]: unknown }>,
>(servers: T, processEnv: Record<string, string | undefined>): T {
  const out = { ...servers };
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg?.env) continue;
    const env: Record<string, string> = {};
    for (const [ek, ev] of Object.entries(cfg.env)) {
      env[ek] = resolveEnvValue(ev, ek, processEnv);
    }
    out[name as keyof T] = { ...cfg, env } as T[keyof T];
  }
  return out;
}

/** Detect likely secret keys for export stripping / UI hints. */
export function looksLikeSecretEnvKey(key: string): boolean {
  return /token|pat|key|secret|password|auth|credential/i.test(key);
}

/** Replace secret env values in mcpServers JSON with `${KEY}` placeholders. */
export function scrubMcpSecretsInContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed['mcpServers'])) return content;
    const copy = structuredClone(parsed) as Record<string, unknown>;
    const servers = copy['mcpServers'] as Record<string, unknown>;
    for (const cfg of Object.values(servers)) {
      if (!isRecord(cfg) || !isRecord(cfg['env'])) continue;
      const env = cfg['env'] as Record<string, string>;
      for (const [ek, ev] of Object.entries(env)) {
        if (!looksLikeSecretEnvKey(ek)) continue;
        if (!ev || ev === `\${${ek}}` || ev === `$${ek}`) {
          env[ek] = `\${${ek}}`;
          continue;
        }
        // Real-looking value — never export it
        env[ek] = `\${${ek}}`;
      }
    }
    return JSON.stringify(copy, null, 2);
  } catch {
    return content;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
