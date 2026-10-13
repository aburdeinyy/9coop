import type { SdkMcpServersRecord } from '../../src/app/core/runtime/mcp-servers';

export interface McpToolDescriptor {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface OpenAiToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ExtractedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

const SEP = '__';

export function encodeMcpToolName(server: string, tool: string): string {
  return `${server}${SEP}${tool}`;
}

export function decodeMcpToolName(
  mangled: string,
): { server: string; tool: string } | null {
  const idx = mangled.indexOf(SEP);
  if (idx <= 0 || idx === mangled.length - SEP.length) return null;
  return {
    server: mangled.slice(0, idx),
    tool: mangled.slice(idx + SEP.length),
  };
}

export function toOpenAiTools(descriptors: McpToolDescriptor[]): OpenAiToolDef[] {
  return descriptors.map((d) => ({
    type: 'function' as const,
    function: {
      name: encodeMcpToolName(d.server, d.name),
      ...(d.description ? { description: d.description } : {}),
      parameters: d.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractToolCalls(payload: unknown): ExtractedToolCall[] {
  if (!isRecord(payload) || !Array.isArray(payload['choices'])) return [];
  const choice = payload['choices'][0];
  if (!isRecord(choice) || !isRecord(choice['message'])) return [];
  const raw = choice['message']['tool_calls'];
  if (!Array.isArray(raw)) return [];

  const out: ExtractedToolCall[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item['function'])) continue;
    const id = typeof item['id'] === 'string' ? item['id'] : '';
    const name =
      typeof item['function']['name'] === 'string' ? item['function']['name'] : '';
    if (!id || !name) continue;
    let args: Record<string, unknown> = {};
    const rawArgs = item['function']['arguments'];
    if (typeof rawArgs === 'string' && rawArgs.trim()) {
      try {
        const parsed = JSON.parse(rawArgs) as unknown;
        if (isRecord(parsed)) args = parsed;
      } catch {
        args = { _raw: rawArgs };
      }
    } else if (isRecord(rawArgs)) {
      args = rawArgs;
    }
    out.push({ id, name, arguments: args });
  }
  return out;
}

export function assistantMessageFromPayload(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload['choices'])) return null;
  const choice = payload['choices'][0];
  if (!isRecord(choice) || !isRecord(choice['message'])) return null;
  return choice['message'];
}

export function contentFromPayload(payload: unknown): string {
  const msg = assistantMessageFromPayload(payload);
  if (!msg) return '';
  return typeof msg['content'] === 'string' ? msg['content'] : '';
}

export const MAX_TOOL_ROUNDS = 8;

export interface ToolLoopDeps {
  url: string;
  apiKey: string;
  model: string;
  temperature?: number;
  messages: unknown[];
  mcpServers: SdkMcpServersRecord;
  fetchImpl: typeof fetch;
  listTools: (servers: SdkMcpServersRecord) => Promise<McpToolDescriptor[]>;
  callTool: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  maxRounds?: number;
}

export async function runOpenAiToolLoop(
  deps: ToolLoopDeps,
): Promise<{ status: number; json: unknown }> {
  const messages: unknown[] = [...deps.messages];
  const serverNames = Object.keys(deps.mcpServers);
  let openAiTools: OpenAiToolDef[] | undefined;

  if (serverNames.length > 0) {
    const descriptors = await deps.listTools(deps.mcpServers);
    if (descriptors.length > 0) {
      openAiTools = toOpenAiTools(descriptors);
    }
  }

  const maxRounds = deps.maxRounds ?? MAX_TOOL_ROUNDS;
  let lastJson: unknown = {};
  let lastStatus = 200;

  for (let round = 0; round < maxRounds; round++) {
    const body: Record<string, unknown> = {
      model: deps.model,
      temperature: typeof deps.temperature === 'number' ? deps.temperature : 0.2,
      messages,
    };
    if (openAiTools?.length) body.tools = openAiTools;

    const upstream = await deps.fetchImpl(deps.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deps.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    lastJson = await upstream.json().catch(() => ({}));
    lastStatus = upstream.status;

    if (!upstream.ok) {
      return { status: upstream.status === 401 ? 401 : 502, json: lastJson };
    }

    const toolCalls = extractToolCalls(lastJson);
    if (toolCalls.length === 0) {
      return { status: 200, json: lastJson };
    }

    const assistantMsg = assistantMessageFromPayload(lastJson);
    if (assistantMsg) messages.push(assistantMsg);

    for (const call of toolCalls) {
      const decoded = decodeMcpToolName(call.name);
      let result: unknown;
      if (!decoded || !deps.mcpServers[decoded.server]) {
        result = { error: `Unknown tool ${call.name}` };
      } else {
        try {
          result = await deps.callTool(decoded.server, decoded.tool, call.arguments);
        } catch (err) {
          result = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  return {
    status: 200,
    json:
      contentFromPayload(lastJson)
        ? lastJson
        : {
            choices: [
              {
                message: {
                  content: 'Превышен лимит tool-раундов без финального ответа.',
                },
              },
            ],
          },
  };
}
