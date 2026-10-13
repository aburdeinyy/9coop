export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'http' | 'sse' | 'unknown';
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Имена tools из skill/MCP markdown (backticks с underscore). */
export function extractDeclaredMcpTools(...texts: Array<string | undefined | null>): string[] {
  const found = new Set<string>();
  const re = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/gi;
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(re)) {
      const name = match[1];
      if (name) found.add(name);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function formatMcpToolsSummary(tools: string[], limit = 8): string {
  if (tools.length === 0) return '(нет в описании)';
  if (tools.length <= limit) return tools.join(', ');
  return `${tools.slice(0, limit).join(', ')} +${tools.length - limit}`;
}

export function mcpServerStatusFromArtifact(artifactContent?: string): McpServerStatus[] {
  if (!artifactContent?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifactContent);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed['mcpServers'])) return [];

  const out: McpServerStatus[] = [];
  for (const [name, cfg] of Object.entries(parsed['mcpServers'])) {
    if (!isRecord(cfg)) continue;
    if (typeof cfg['url'] === 'string' && cfg['url'].trim()) {
      const type = cfg['type'] === 'sse' ? 'sse' : 'http';
      out.push({ name, transport: type, detail: cfg['url'].trim() });
      continue;
    }
    if (typeof cfg['command'] === 'string' && cfg['command'].trim()) {
      const args = Array.isArray(cfg['args'])
        ? cfg['args'].filter((a): a is string => typeof a === 'string')
        : [];
      out.push({
        name,
        transport: 'stdio',
        detail: [cfg['command'].trim(), ...args].join(' '),
      });
      continue;
    }
    out.push({ name, transport: 'unknown', detail: '' });
  }
  return out;
}

export function redactMcpArtifactForDisplay(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed['mcpServers'])) return content;
    const copy = structuredClone(parsed) as Record<string, unknown>;
    const servers = copy['mcpServers'] as Record<string, unknown>;
    for (const cfg of Object.values(servers)) {
      if (!isRecord(cfg)) continue;
      if (isRecord(cfg['env'])) {
        for (const key of Object.keys(cfg['env'])) {
          if (/token|pat|key|secret|password|auth/i.test(key)) {
            (cfg['env'] as Record<string, string>)[key] = '••••••••';
          }
        }
      }
      if (isRecord(cfg['headers'])) {
        for (const key of Object.keys(cfg['headers'])) {
          if (/auth|token|key|secret/i.test(key)) {
            (cfg['headers'] as Record<string, string>)[key] = '••••••••';
          }
        }
      }
    }
    return JSON.stringify(copy, null, 2);
  } catch {
    return content;
  }
}
