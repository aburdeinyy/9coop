import { parseMcpServersFromArtifactContent } from '../../src/app/core/runtime/mcp-servers';
import { runRefreshSource } from '../../src/app/core/utils/auto-refresh';
import type { ViewSpec } from '../../src/app/core/models/node-view.model';
import { applyProcessEnvToMcpServers } from '../../src/app/core/utils/dotenv-format';
import { readEnvFile } from './env-store';
import { callStdioMcpTool } from './mcp-stdio';

export interface McpRefreshRequest {
  artifactContent: string;
  server: string;
  source: string;
}

export { callStdioMcpTool, listStdioMcpTools, listToolsFromMcpServers, callToolOnMcpServers } from './mcp-stdio';

export async function runMcpRefresh(
  body: McpRefreshRequest,
  cwd: string,
  callTool: typeof callStdioMcpTool = callStdioMcpTool,
): Promise<ViewSpec> {
  const servers = parseMcpServersFromArtifactContent(body.artifactContent);
  const withEnv = applyProcessEnvToMcpServers(
    Object.fromEntries(
      servers.map((s) => [
        s.name,
        {
          type: s.type,
          command: s.command,
          args: s.args,
          env: s.env,
          url: s.url,
          headers: s.headers,
        },
      ]),
    ),
    { ...process.env, ...readEnvFile(cwd) },
  );
  const server = servers.find((s) => s.name === body.server);
  const cfg = withEnv[body.server];
  if (!server || server.type !== 'stdio' || !server.command || !cfg) {
    throw new Error('Для автообновления нужен stdio MCP из layercoopRefresh.server');
  }
  const env = (cfg.env ?? {}) as Record<string, string>;
  const view = await runRefreshSource(body.source, (name, args) =>
    callTool(server.command!, server.args ?? [], env, name, args),
  );
  if (!view) throw new Error('MCP refresh не вернул view');
  return view;
}
