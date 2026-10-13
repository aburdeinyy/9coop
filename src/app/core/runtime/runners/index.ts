import type { GodNodeData, RunnerId } from '../../models/graph.model';
import { RUNNER_LABELS } from '../../models/graph.model';
import type { ChatContext } from '../../utils/compose-context';
import {
  completeBridgeRun,
  isClientRunner,
  isLocalRunner,
  streamBridgeRun,
  type BridgeSseEvent,
  type CursorLocalOptions,
} from '../llm-provider';
import {
  createOpenAiCompatibleRunner,
  streamAnthropicStub,
  streamOpenAiCompatible,
} from './openai-compatible';

export type { BridgeSseEvent };
export {
  isClientRunner,
  isLocalRunner,
  createOpenAiCompatibleRunner,
  streamOpenAiCompatible,
  streamAnthropicStub,
};

/**
 * Единая точка стрима для любого RunnerId (local bridge или client HTTP).
 * События — тот же контракт BridgeSseEvent.
 */
export async function* streamRunner(
  god: GodNodeData,
  context: ChatContext,
  options: CursorLocalOptions = {},
): AsyncGenerator<BridgeSseEvent> {
  if (isLocalRunner(god.runner)) {
    yield* streamBridgeRun(god, context, options);
    return;
  }

  if (isClientRunner(god.runner)) {
    yield* streamOpenAiCompatible(god, context, options);
    return;
  }

  if (god.runner === 'anthropic') {
    yield* streamAnthropicStub(god, context, options);
    return;
  }

  yield {
    type: 'error',
    message: `Runner «${god.runner}» ещё не подключён.`,
  };
}

export async function completeRunner(
  god: GodNodeData,
  context: ChatContext,
  options: CursorLocalOptions = {},
): Promise<string> {
  if (isLocalRunner(god.runner)) {
    return completeBridgeRun(god, context, options);
  }

  let result = '';
  let tokens = '';
  for await (const event of streamRunner(god, context, options)) {
    if (event.type === 'token') tokens += event.text;
    if (event.type === 'done') result = event.result || tokens;
    if (event.type === 'error') throw new Error(event.message);
  }
  if (!result && tokens) return tokens;
  if (!result) {
    throw new Error(`Пустой ответ runner (${RUNNER_LABELS[god.runner as RunnerId]})`);
  }
  return result;
}
