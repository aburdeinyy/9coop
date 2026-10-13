import {
  LOCAL_RUNNER_IDS,
  coerceLocalRunner,
} from '../../../src/app/core/runtime/local-runners';
import { runLocalCursorAgent } from './cursor';
import { runClaudeCodeAgent } from './claude-code';
import { runOpencodeAgent } from './opencode';
import type { AgentRunner, LocalRunnerId } from '../types';

export type RunnerOverrides = Partial<Record<LocalRunnerId, AgentRunner>>;

export const DEFAULT_RUNNERS: Record<LocalRunnerId, AgentRunner> = {
  cursor: runLocalCursorAgent,
  'claude-code': runClaudeCodeAgent,
  opencode: runOpencodeAgent,
};

export const AVAILABLE_RUNNERS = LOCAL_RUNNER_IDS;

/** @deprecated используй AVAILABLE_RUNNERS */
export const AVAILABLE_RUNTIMES = AVAILABLE_RUNNERS;

/** Неизвестный runner — не ошибка: падаем на 'cursor' ради старых клиентов. */
export function resolveRunner(runner: unknown, overrides: RunnerOverrides = {}): AgentRunner {
  const id = coerceLocalRunner(runner);
  return overrides[id] ?? DEFAULT_RUNNERS[id];
}

export { runClaudeCodeAgent, runOpencodeAgent, runLocalCursorAgent };
