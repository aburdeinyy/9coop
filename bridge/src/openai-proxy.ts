import { chatCompletionsUrl, modelsListUrl } from '../../src/app/core/runtime/llm-provider';
import {
  toSdkMcpServersRecord,
  type McpServerInline,
  type SdkMcpServersRecord,
} from '../../src/app/core/runtime/mcp-servers';
import { applyProcessEnvToMcpServers } from '../../src/app/core/utils/dotenv-format';
import { loadEnvIntoProcess, readEnvFile } from './env-store';
import { loadDiskMcpServers, mergeMcpServers } from './runners/cursor';
import { callToolOnMcpServers, listToolsFromMcpServers } from './mcp-stdio';
import { runOpenAiToolLoop } from './openai-tool-loop';

export interface OpenAiProxyChatBody {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  messages?: unknown;
  apiKey?: string;
  apiKeyEnv?: string;
  /** MCP из connected artifact-нод (массив или record). */
  mcpServers?: McpServerInline[] | Record<string, unknown>;
  /** Подхватить `.layercoop/mcp.json` (как Cursor runner). По умолчанию false; клиент шлёт true. */
  useDiskMcp?: boolean;
}

export interface OpenAiProxyModelsBody {
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
}

export function resolveProxyApiKey(
  apiKey: string | undefined,
  apiKeyEnv: string | undefined,
  cwd: string,
): string {
  const direct = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (direct) return direct;
  const envName = typeof apiKeyEnv === 'string' ? apiKeyEnv.trim() : '';
  if (!envName) return '';
  const vars = readEnvFile(cwd);
  return (vars[envName] ?? process.env[envName] ?? '').trim();
}

function normalizeProxyMcpServers(
  input: OpenAiProxyChatBody['mcpServers'],
): SdkMcpServersRecord {
  if (!input) return {};
  if (Array.isArray(input)) {
    return toSdkMcpServersRecord(input as McpServerInline[]);
  }
  const record: SdkMcpServersRecord = {};
  for (const [name, cfg] of Object.entries(input)) {
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
      record[name] = cfg as SdkMcpServersRecord[string];
    }
  }
  return record;
}

export function resolveMcpServersForProxy(
  body: OpenAiProxyChatBody,
  cwd: string,
): SdkMcpServersRecord {
  loadEnvIntoProcess(cwd);
  const fromRequest = normalizeProxyMcpServers(body.mcpServers);
  const useDisk = body.useDiskMcp === true;
  const merged = useDisk
    ? mergeMcpServers(loadDiskMcpServers(cwd), fromRequest)
    : fromRequest;
  return applyProcessEnvToMcpServers(merged, process.env);
}

function upstreamErrorHint(
  url: string,
  status: number,
  json: unknown,
): string {
  const upstreamMsg =
    (json as { error?: { message?: string } | string })?.error &&
    (typeof (json as { error: unknown }).error === 'string'
      ? (json as { error: string }).error
      : (json as { error?: { message?: string } }).error?.message);
  if (status === 401) {
    return `Unauthorized (401) от ${url}. Проверь API key OpenWebUI и Base URL (часто …/api/v1).`;
  }
  return upstreamMsg || `HTTP ${status}`;
}

export async function proxyOpenAiChatCompletions(
  body: OpenAiProxyChatBody,
  cwd: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; json: unknown }> {
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const url = chatCompletionsUrl(baseUrl);
  if (!url) {
    return { status: 400, json: { error: { message: 'Укажите baseUrl' } } };
  }
  if (!model) {
    return { status: 400, json: { error: { message: 'Укажите model' } } };
  }

  const apiKey = resolveProxyApiKey(body.apiKey, body.apiKeyEnv, cwd);
  if (!apiKey) {
    return {
      status: 401,
      json: {
        error: {
          message:
            'Нет API key: вставь ключ в ноду или укажи apiKeyEnv (например OPEN_WEBUI_TOKEN) и проверь Secrets / .env',
        },
      },
    };
  }

  const mcpServers = resolveMcpServersForProxy(body, cwd);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serverNames = Object.keys(mcpServers);

  if (serverNames.length === 0) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    const upstream = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
        messages,
      }),
    });
    const json: unknown = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return {
        status: upstream.status === 401 ? 401 : 502,
        json: { error: { message: upstreamErrorHint(url, upstream.status, json) } },
      };
    }
    return { status: 200, json };
  }

  console.log(
    `[layercoop-bridge] openai tool-loop servers=${serverNames.join(',') || '(none)'}`,
  );

  const result = await runOpenAiToolLoop({
    url,
    apiKey,
    model,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
    messages,
    mcpServers,
    fetchImpl,
    listTools: async (servers) => {
      const tools = await listToolsFromMcpServers(servers);
      console.log(
        `[layercoop-bridge] openai tools listed=${tools.length} (${tools
          .slice(0, 8)
          .map((t) => t.name)
          .join(',')}${tools.length > 8 ? '…' : ''})`,
      );
      return tools;
    },
    callTool: (server, tool, args) => callToolOnMcpServers(mcpServers, server, tool, args),
  });

  if (result.status !== 200) {
    return {
      status: result.status,
      json: {
        error: {
          message: upstreamErrorHint(url, result.status, result.json),
        },
      },
    };
  }
  return result;
}

export async function proxyOpenAiModels(
  body: OpenAiProxyModelsBody,
  cwd: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; json: unknown }> {
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const url = modelsListUrl(baseUrl);
  if (!url) {
    return { status: 400, json: { error: { message: 'Укажите baseUrl' } } };
  }
  const apiKey = resolveProxyApiKey(body.apiKey, body.apiKeyEnv, cwd);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const upstream = await fetchImpl(url, { method: 'GET', headers });
  const json: unknown = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const msg =
      upstream.status === 401
        ? `Unauthorized (401) от ${url}. Проверь API key / apiKeyEnv.`
        : (json as { error?: { message?: string } })?.error?.message || `HTTP ${upstream.status}`;
    return { status: upstream.status === 401 ? 401 : 502, json: { error: { message: msg } } };
  }
  return { status: 200, json };
}
