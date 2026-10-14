export interface McpServerInline {
  name: string;
  type?: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Shape expected by @cursor/sdk mcpServers. */
export type SdkMcpServersRecord = Record<
  string,
  {
    type?: 'http' | 'sse' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    cwd?: string;
  }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse one artifactContent JSON blob into inline MCP server entries. */
export function parseMcpServersFromArtifactContent(artifactContent: string): McpServerInline[] {
  const servers: McpServerInline[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifactContent);
  } catch {
    return servers;
  }
  if (!isRecord(parsed) || !isRecord(parsed['mcpServers'])) return servers;

  for (const [name, cfg] of Object.entries(parsed['mcpServers'])) {
    if (!isRecord(cfg)) continue;
    const entry: McpServerInline = { name };

    if (typeof cfg['url'] === 'string' && cfg['url'].trim()) {
      entry.type = cfg['type'] === 'sse' ? 'sse' : 'http';
      entry.url = cfg['url'].trim();
      if (isRecord(cfg['headers'])) {
        const headers: Record<string, string> = {};
        for (const [hk, hv] of Object.entries(cfg['headers'])) {
          if (typeof hv === 'string') headers[hk] = hv;
        }
        if (Object.keys(headers).length) entry.headers = headers;
      }
      servers.push(entry);
      continue;
    }

    if (typeof cfg['command'] === 'string' && cfg['command'].trim()) {
      entry.type = 'stdio';
      entry.command = cfg['command'].trim();
      if (Array.isArray(cfg['args']) && cfg['args'].every((a) => typeof a === 'string')) {
        entry.args = cfg['args'] as string[];
      }
      if (isRecord(cfg['env'])) {
        const env: Record<string, string> = {};
        for (const [ek, ev] of Object.entries(cfg['env'])) {
          if (typeof ev === 'string') env[ek] = ev;
        }
        if (Object.keys(env).length) entry.env = env;
      }
      servers.push(entry);
    }
  }

  return servers;
}

export interface McpArtifactLike {
  kind: string;
  artifactContent?: string;
}

/** MCP only from connected artifact nodes that carry mcpServers JSON. */
export function buildMcpServersFromArtifacts(artifacts: McpArtifactLike[]): McpServerInline[] {
  const servers: McpServerInline[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== 'mcp' || !artifact.artifactContent?.trim()) continue;
    servers.push(...parseMcpServersFromArtifactContent(artifact.artifactContent));
  }
  return servers;
}

const REPOS_FS_NAME = 'repos-fs';
const FS_PACKAGE = '@modelcontextprotocol/server-filesystem';

/**
 * Launcher `.layercoop/mcp.d/repos-fs.mjs` читает graph.json с диска — UI его не пишет.
 * Подменяем на прямой server-filesystem с абсолютными корнями из repo-нод графа.
 */
export function withRepoFilesystemMcp(
  servers: McpServerInline[],
  repoRoots: string[],
): McpServerInline[] {
  const roots = [...new Set(repoRoots.map((p) => p.trim()).filter(Boolean))];
  if (roots.length === 0) return servers;
  const rest = servers.filter((s) => s.name !== REPOS_FS_NAME);
  rest.push({
    name: REPOS_FS_NAME,
    type: 'stdio',
    command: 'npx',
    args: ['-y', FS_PACKAGE, ...roots],
  });
  return rest;
}

export function toSdkMcpServersRecord(servers: McpServerInline[]): SdkMcpServersRecord {
  const record: SdkMcpServersRecord = {};
  for (const s of servers) {
    const cfg: SdkMcpServersRecord[string] = {};
    if (s.type) cfg.type = s.type;
    if (s.url) cfg.url = s.url;
    if (s.command) cfg.command = s.command;
    if (s.args) cfg.args = s.args;
    if (s.env) cfg.env = s.env;
    if (s.headers) cfg.headers = s.headers;
    record[s.name] = cfg;
  }
  return record;
}
