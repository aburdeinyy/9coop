import type { McpServerInline } from '../../src/app/core/runtime/mcp-servers';
import type { LocalRunnerId } from '../../src/app/core/runtime/local-runners';

export type { LocalRunnerId };
/** @deprecated используй LocalRunnerId */
export type { LocalRunnerId as BridgeRuntimeId };

export type BridgeTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type BridgeSseEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool';
      name: string;
      status: 'start' | 'end';
      callId?: string;
      /** Человекочитаемое «что делаю» (из args). */
      detail?: string;
    }
  | {
      type: 'done';
      result: string;
      durationMs?: number;
      usage?: BridgeTokenUsage;
    }
  | { type: 'error'; message: string };

export interface BridgeRunRequest {
  /** Какой local runner запускать. Отсутствие = 'cursor' (обратная совместимость). */
  runner?: LocalRunnerId;
  /**
   * @deprecated используй `runner`. Старые клиенты шлют `runtime`.
   */
  runtime?: LocalRunnerId;
  apiKey: string;
  model?: string;
  prompt: string;
  systemContext?: string;
  mcpServers?: McpServerInline[] | Record<string, unknown>;
  cwd?: string;
  /**
   * claude-code: запуск с `--bare` — не читает CLAUDE.md, хуки, .mcp.json, плагины.
   * Даёт изоляцию графа, но требует ANTHROPIC_API_KEY: bare-режим не использует
   * подписочный login. Без флага работает подписка Pro/Max, но натекает ambient-контекст.
   */
  isolated?: boolean;
  /** opencode: базовый URL headless-сервера (`opencode serve`). */
  baseUrl?: string;
}

export interface AgentRunner {
  (req: BridgeRunRequest): AsyncIterable<BridgeSseEvent>;
}

/** Выбирает id runner из тела запроса (канон `runner`, legacy `runtime`). */
export function pickRunnerId(body: Pick<BridgeRunRequest, 'runner' | 'runtime'>): unknown {
  return body.runner ?? body.runtime;
}
