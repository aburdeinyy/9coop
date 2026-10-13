import fs from 'node:fs';
import path from 'node:path';
import { Agent, Cursor } from '@cursor/sdk';
import {
  toSdkMcpServersRecord,
  type McpServerInline,
  type SdkMcpServersRecord,
} from '../../../src/app/core/runtime/mcp-servers';
import { applyProcessEnvToMcpServers } from '../../../src/app/core/utils/dotenv-format';
import {
  parseCursorModelSelection,
  parseCursorModelsList,
  type CursorModelOption,
} from '../../../src/app/core/runtime/llm-provider';
import { loadEnvIntoProcess } from '../env-store';
import { buildPrompt } from '../prompt';
import { formatToolStepLabel } from '../../../src/app/core/utils/tool-label';
import type { AgentRunner, BridgeRunRequest, BridgeSseEvent } from '../types';

function normalizeMcpServers(
  input: BridgeRunRequest['mcpServers'],
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

export function loadDiskMcpServers(cwd: string): SdkMcpServersRecord {
  const file = path.join(cwd, '.layercoop', 'mcp.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (!parsed?.mcpServers || typeof parsed.mcpServers !== 'object') return {};
    return normalizeMcpServers(parsed.mcpServers);
  } catch {
    return {};
  }
}

/** Disk fills gaps; request/graph overrides same names. */
export function mergeMcpServers(
  disk: SdkMcpServersRecord,
  fromRequest: SdkMcpServersRecord,
): SdkMcpServersRecord {
  return { ...disk, ...fromRequest };
}

export async function listCursorModels(
  apiKey: string,
  listImpl: (opts: { apiKey: string }) => Promise<unknown> = (opts) => Cursor.models.list(opts),
): Promise<CursorModelOption[]> {
  const models = await listImpl({ apiKey });
  return parseCursorModelsList(models);
}

export const runLocalCursorAgent: AgentRunner = async function* (
  req: BridgeRunRequest,
): AsyncGenerator<BridgeSseEvent> {
  if (!req.apiKey?.trim()) {
    yield { type: 'error', message: 'Укажите Cursor API key' };
    return;
  }

  const model = parseCursorModelSelection(req.model);
  const cwd = req.cwd?.trim() || process.cwd();
  loadEnvIntoProcess(cwd);

  const merged = mergeMcpServers(loadDiskMcpServers(cwd), normalizeMcpServers(req.mcpServers));
  const mcpServers = applyProcessEnvToMcpServers(merged, process.env);
  const mcpNames = Object.keys(mcpServers);
  console.log(
    `[layercoop-bridge] cwd=${cwd} mcpServers=${mcpNames.length ? mcpNames.join(',') : '(none)'}`,
  );

  let accumulated = '';
  /** input из assistant tool_use — args в tool_call иногда приходят поздно/пустыми */
  const toolArgsById = new Map<string, unknown>();
  try {
    await using agent = await Agent.create({
      apiKey: req.apiKey.trim(),
      model,
      local: { cwd },
      mcpServers,
    });

    const run = await agent.send(buildPrompt(req));
    for await (const event of run.stream()) {
      if (event.type === 'assistant') {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            accumulated += block.text;
            yield { type: 'token', text: block.text };
          } else if (block.type === 'tool_use') {
            toolArgsById.set(block.id, block.input);
          }
        }
      } else if (event.type === 'tool_call') {
        const status = event.status === 'running' ? 'start' : 'end';
        const args = event.args ?? toolArgsById.get(event.call_id);
        yield {
          type: 'tool',
          name: event.name,
          status,
          callId: event.call_id,
          detail: formatToolStepLabel(event.name, args),
        };
      }
    }

    const result = await run.wait();
    if (result.status === 'error') {
      yield {
        type: 'error',
        message: result.error?.message || result.result || 'Cursor local run ERROR',
      };
      return;
    }
    if (result.status === 'cancelled') {
      yield { type: 'error', message: 'Cursor run отменён' };
      return;
    }
    const usage = result.usage
      ? {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          cacheReadTokens: result.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
          ...(result.usage.reasoningTokens != null
            ? { reasoningTokens: result.usage.reasoningTokens }
            : {}),
        }
      : undefined;
    yield {
      type: 'done',
      result: result.result || accumulated,
      ...(typeof result.durationMs === 'number' ? { durationMs: result.durationMs } : {}),
      ...(usage && usage.totalTokens > 0 ? { usage } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
  }
};
