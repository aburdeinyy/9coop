/** Local-раннеры, которые исполняет layercoop-bridge. */
export type LocalRunnerId = 'cursor' | 'claude-code' | 'opencode';

export const LOCAL_RUNNER_IDS: LocalRunnerId[] = ['cursor', 'claude-code', 'opencode'];

export const DEFAULT_LOCAL_RUNNER: LocalRunnerId = 'cursor';

/** Headless-сервер opencode по умолчанию (`opencode serve`). */
export const DEFAULT_OPENCODE_BASE_URL = 'http://127.0.0.1:4096';

export function coerceLocalRunner(value: unknown): LocalRunnerId {
  if (typeof value === 'string' && (LOCAL_RUNNER_IDS as string[]).includes(value)) {
    return value as LocalRunnerId;
  }
  return DEFAULT_LOCAL_RUNNER;
}

/** @deprecated используй LocalRunnerId */
export type BridgeRuntimeId = LocalRunnerId;
/** @deprecated используй LOCAL_RUNNER_IDS */
export const BRIDGE_RUNTIME_IDS = LOCAL_RUNNER_IDS;
/** @deprecated используй DEFAULT_LOCAL_RUNNER */
export const DEFAULT_BRIDGE_RUNTIME = DEFAULT_LOCAL_RUNNER;
/** @deprecated используй coerceLocalRunner */
export const coerceBridgeRuntime = coerceLocalRunner;
