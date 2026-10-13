import type { GodNodeData } from '../../models/graph.model';
import type { ChatContext } from '../../utils/compose-context';
import { isAbortError } from '../abort';
import {
  buildChatCompletionsRequest,
  completeOpenAiCompatible,
  parseChatCompletionsContent,
  type BridgeSseEvent,
  type CursorLocalOptions,
} from '../llm-provider';

export interface OpenAiCompatibleRunnerDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Client runner: OpenAI / OpenAI-compatible chat/completions → BridgeSseEvent.
 * Стриминг API пока не используем — отдаём один token + done (единый контракт с local).
 */
export function createOpenAiCompatibleRunner(
  deps: OpenAiCompatibleRunnerDeps = {},
): (
  god: GodNodeData,
  context: ChatContext,
  options?: CursorLocalOptions,
) => AsyncGenerator<BridgeSseEvent> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async function* (
    god: GodNodeData,
    context: ChatContext,
    options: CursorLocalOptions = {},
  ): AsyncGenerator<BridgeSseEvent> {
    const fetchFn = options.fetchImpl ?? fetchImpl;
    try {
      const content = await completeOpenAiCompatible(god, context, fetchFn, options.signal);
      const token: BridgeSseEvent = { type: 'token', text: content };
      options.onEvent?.(token);
      yield token;
      const done: BridgeSseEvent = { type: 'done', result: content };
      options.onEvent?.(done);
      yield done;
    } catch (err) {
      if (isAbortError(err) || options.signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const error: BridgeSseEvent = { type: 'error', message };
      options.onEvent?.(error);
      yield error;
    }
  };
}

export const streamOpenAiCompatible = createOpenAiCompatibleRunner();

/** Anthropic API напрямую пока не подключён (roadmap) — только через claude-code. */
export async function* streamAnthropicStub(
  _god: GodNodeData,
  _context: ChatContext,
  options: CursorLocalOptions = {},
): AsyncGenerator<BridgeSseEvent> {
  const error: BridgeSseEvent = {
    type: 'error',
    message:
      'Anthropic напрямую не подключён. Выберите runner Claude Code (local) или смотрите roadmap.',
  };
  options.onEvent?.(error);
  yield error;
}

export { buildChatCompletionsRequest, parseChatCompletionsContent, completeOpenAiCompatible };
