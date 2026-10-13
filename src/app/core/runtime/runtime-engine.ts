import { GOD_NODE_ID, isArtifactData, isGodData, normalizeGodData } from '../models/graph.model';
import type { ChatMessage, LayercoopGraph, RunnerId } from '../models/graph.model';
import { composeChatContext, toUserVisibleReply } from '../utils/compose-context';
import { connectedSubGods, resolveExecutor } from '../utils/god-nodes';
import { extractLayercoopDelegate } from '../utils/god-delegate';
import { edgeOnPathFromGod } from '../utils/graph-links';
import { resolveToolNodeId } from '../utils/tool-node';
import type { RuntimeEvent, RuntimeOptions, RuntimeStreamFn } from './runtime-events';
import { buildRuntimePlan } from './runtime-plan';
import { isLocalRunner } from './llm-provider';
import { completeRunner, streamRunner } from './runners';
import { RUNNER_LABELS } from '../models/graph.model';
import { abortableDelay, isAbortError, throwIfAborted } from './abort';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const MAX_DELEGATE_ROUNDS = 3;

function chunkTokens(text: string): string[] {
  const parts = text.match(/\S+\s*/g);
  return parts && parts.length > 0 ? parts : [text];
}

/** Единый текст ошибки для любого runner. */
function runnerFailure(god: { runner: RunnerId; model: string }, message: string): string {
  const label = RUNNER_LABELS[god.runner];
  return `Не удалось вызвать ${label} (${god.model || 'модель не задана'}): ${message}`;
}

export async function defaultComplete(
  graph: LayercoopGraph,
  userPrompt: string,
  opts: {
    focusNodeId: string;
    chatHistory: ChatMessage[];
    executorNodeId?: string;
    signal?: AbortSignal;
    forceArtifactIds?: string[];
  } = {
    focusNodeId: GOD_NODE_ID,
    chatHistory: [],
  },
): Promise<string> {
  const executorNodeId = opts.executorNodeId ?? opts.focusNodeId;
  const context = composeChatContext(graph, userPrompt, {
    focusNodeId: opts.focusNodeId,
    chatHistory: opts.chatHistory,
    forceArtifactIds: opts.forceArtifactIds,
  });
  const god = resolveExecutor(graph, executorNodeId);

  try {
    return await completeRunner(god, context, { signal: opts.signal });
  } catch (err) {
    if (isAbortError(err) || opts.signal?.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return runnerFailure(god, message);
  }
}

async function* streamExecutor(
  graph: LayercoopGraph,
  prompt: string,
  executorNodeId: string,
  chatFocusNodeId: string,
  chatHistory: ChatMessage[],
  signal: AbortSignal | undefined,
  streamFn: RuntimeStreamFn,
  tokenMs: number,
  pause: (ms: number) => Promise<void>,
  /** false — токены только в шаги (саб-GOD), не в финальный текст чата. */
  toChat = true,
  forceArtifactIds?: string[],
): AsyncGenerator<RuntimeEvent, string> {
  const god = resolveExecutor(graph, executorNodeId);
  let streamed = '';
  const emitToken = (text: string): RuntimeEvent =>
    toChat ? { type: 'token', text } : { type: 'token', text, toChat: false };

  try {
    for await (const event of streamFn(graph, prompt, {
      focusNodeId: chatFocusNodeId,
      chatHistory,
      executorNodeId,
      signal,
      forceArtifactIds,
    })) {
      throwIfAborted(signal);
      if (event.type === 'token') {
        streamed += event.text;
        yield emitToken(event.text);
      } else if (event.type === 'tool') {
        yield {
          type: 'tool:call',
          nodeId: resolveToolNodeId(graph, event.name, executorNodeId),
          name: event.name,
          status: event.status,
          callId: event.callId,
          detail: event.detail,
        };
      } else if (event.type === 'error') {
        throw new Error(event.message);
      } else if (event.type === 'done') {
        if (!streamed) {
          const finalText = toUserVisibleReply(event.result || '');
          for (const text of chunkTokens(finalText)) {
            throwIfAborted(signal);
            streamed += text;
            yield emitToken(text);
            await pause(tokenMs);
          }
        } else if (event.result && !streamed.includes(event.result)) {
          // уже стримили thoughts — raw result нужен для delegate-парсинга
          streamed = event.result;
        }
        if (event.usage || typeof event.durationMs === 'number') {
          yield {
            type: 'run:stats',
            stats: {
              durationMs: typeof event.durationMs === 'number' ? event.durationMs : 0,
              ...(event.usage
                ? {
                    usage: {
                      inputTokens: event.usage.inputTokens ?? 0,
                      outputTokens: event.usage.outputTokens ?? 0,
                      cacheReadTokens: event.usage.cacheReadTokens ?? 0,
                      cacheWriteTokens: event.usage.cacheWriteTokens ?? 0,
                      totalTokens: event.usage.totalTokens ?? 0,
                      ...(event.usage.reasoningTokens != null
                        ? { reasoningTokens: event.usage.reasoningTokens }
                        : {}),
                    },
                  }
                : {}),
            },
          };
        }
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const fallback = runnerFailure(god, message);
    for (const text of chunkTokens(fallback)) {
      yield emitToken(text);
      await pause(tokenMs);
    }
    return fallback;
  }

  return streamed;
}

function defaultStreamFn(
  graph: LayercoopGraph,
  _prompt: string,
  opts: {
    focusNodeId: string;
    chatHistory: ChatMessage[];
    executorNodeId?: string;
    signal?: AbortSignal;
    forceArtifactIds?: string[];
  },
): AsyncGenerator<import('./llm-provider').BridgeSseEvent> {
  const executorNodeId = opts.executorNodeId ?? opts.focusNodeId;
  const context = composeChatContext(graph, _prompt, {
    focusNodeId: opts.focusNodeId,
    chatHistory: opts.chatHistory,
    forceArtifactIds: opts.forceArtifactIds,
  });
  const god = resolveExecutor(graph, executorNodeId);
  return streamRunner(god, context, { signal: opts.signal });
}

export async function* runRuntime(
  graph: LayercoopGraph,
  userPrompt: string,
  options: RuntimeOptions = {},
): AsyncGenerator<RuntimeEvent> {
  const delayImpl = options.delay ?? wait;
  const stepMs = options.stepMs ?? 70;
  const tokenMs = options.tokenMs ?? 18;
  const runId = options.runId ?? `run-${Date.now()}`;
  const focusNodeId = options.focusNodeId ?? GOD_NODE_ID;
  const chatHistory = options.chatHistory ?? [];
  const forceArtifactIds = options.forceArtifactIds;
  const signal = options.signal;
  const pause = (ms: number) => abortableDelay(ms, delayImpl, signal);
  const complete =
    options.complete ??
    ((g, prompt, opts) =>
      defaultComplete(g, prompt, { ...opts, signal, forceArtifactIds }));
  const streamFn = options.stream ?? defaultStreamFn;
  const plan = buildRuntimePlan(graph);
  const primaryGod = resolveExecutor(graph, GOD_NODE_ID);
  const useEventStream = !options.complete;
  const subGods = connectedSubGods(graph);
  const canDelegate = focusNodeId === GOD_NODE_ID && subGods.length > 0;
  const executorFocus =
    graph.nodes.find((n) => n.id === focusNodeId)?.type === 'god' ? focusNodeId : GOD_NODE_ID;

  yield { type: 'run:start', runId };

  try {
    throwIfAborted(signal);

    const preview = composeChatContext(graph, userPrompt, {
      focusNodeId,
      chatHistory,
      forceArtifactIds,
    });
    const contextNodeIds = preview.selectedArtifactIds;
    const contextEdgeIds = contextNodeIds
      .map((id) => edgeOnPathFromGod(graph, id))
      .filter((id): id is string => !!id);
    const contextSet = new Set(contextNodeIds);

    yield {
      type: 'run:context',
      nodeIds: contextNodeIds,
      edgeIds: contextEdgeIds,
    };

    yield { type: 'node:active', nodeId: executorFocus };
    if (focusNodeId !== executorFocus) {
      yield { type: 'node:active', nodeId: focusNodeId };
    }
    await pause(stepMs);

    // Короткий «сбор» только по нодам, реально попавшим в контекст (не весь граф).
    for (const step of plan) {
      throwIfAborted(signal);
      if (step.kind === 'god') continue;
      if (!contextSet.has(step.nodeId)) continue;
      if (step.edgeId) {
        yield { type: 'edge:flow', edgeId: step.edgeId };
        await pause(stepMs);
      }

      yield { type: 'node:active', nodeId: step.nodeId };

      if (step.kind === 'mcp' && !(isLocalRunner(primaryGod.runner) && useEventStream)) {
        const node = graph.nodes.find((n) => n.id === step.nodeId);
        const name = node && isArtifactData(node.data) ? node.data.label : step.nodeId;
        yield { type: 'tool:call', nodeId: step.nodeId, name, status: 'start' };
        await pause(stepMs);
        yield { type: 'tool:call', nodeId: step.nodeId, name, status: 'end' };
      }

      await pause(stepMs);
      yield { type: 'node:done', nodeId: step.nodeId };
    }

    const runOnce = async (
      executorNodeId: string,
      prompt: string,
      history: ChatMessage[],
    ): Promise<string> => {
      return complete(graph, prompt, {
        focusNodeId,
        chatHistory: history,
        executorNodeId,
        forceArtifactIds,
      });
    };

    let finalRaw = '';

    if (useEventStream) {
      if (!canDelegate) {
        yield* streamExecutor(
          graph,
          userPrompt,
          executorFocus,
          focusNodeId,
          chatHistory,
          signal,
          streamFn,
          tokenMs,
          pause,
          true,
          forceArtifactIds,
        );
        yield { type: 'node:done', nodeId: executorFocus };
        if (focusNodeId !== executorFocus) {
          yield { type: 'node:done', nodeId: focusNodeId };
        }
        yield { type: 'run:end', runId };
        return;
      }

      let prompt = userPrompt;
      let history = chatHistory;
      let executorId = GOD_NODE_ID;

      for (let round = 0; round < MAX_DELEGATE_ROUNDS; round++) {
        throwIfAborted(signal);
        yield { type: 'node:active', nodeId: executorId };
        const reply = yield* streamExecutor(
          graph,
          prompt,
          executorId,
          focusNodeId,
          history,
          signal,
          streamFn,
          tokenMs,
          pause,
          true,
          forceArtifactIds,
        );
        const delegate =
          executorId === GOD_NODE_ID ? extractLayercoopDelegate(reply) : null;
        const target =
          delegate && subGods.find((n) => n.id === delegate.targetId);

        if (!delegate || !target || round === MAX_DELEGATE_ROUNDS - 1) {
          finalRaw = reply;
          break;
        }

        const edgeId = edgeOnPathFromGod(graph, target.id);
        if (edgeId) {
          yield { type: 'edge:flow', edgeId };
          await pause(stepMs);
        }
        yield { type: 'node:active', nodeId: target.id };
        const subResult = yield* streamExecutor(
          graph,
          delegate.task,
          target.id,
          focusNodeId,
          [],
          signal,
          streamFn,
          tokenMs,
          pause,
          false,
          forceArtifactIds,
        );
        yield { type: 'node:done', nodeId: target.id };

        const label =
          isGodData(target.data) && target.data.label
            ? normalizeGodData(target.data).label
            : target.id;
        executorId = GOD_NODE_ID;
        history = [];
        prompt = [
          `Саб-GOD «${label}» (${target.id}) выполнил задачу:`,
          delegate.task,
          '',
          'Результат:',
          subResult,
          '',
          'Провалидируй результат и ответь пользователю.',
          'Не используй fence layercoop-delegate снова, если задача уже выполнена.',
        ].join('\n');
      }

      const reply = toUserVisibleReply(finalRaw);
      // Если финал уже ушёл токенами — не дублируем; иначе (только done/delegate) — покажем.
      if (reply && reply !== finalRaw) {
        for (const text of chunkTokens(reply)) {
          throwIfAborted(signal);
          yield { type: 'token', text };
          await pause(tokenMs);
        }
      }

      yield { type: 'node:done', nodeId: GOD_NODE_ID };
      if (focusNodeId !== GOD_NODE_ID) {
        yield { type: 'node:done', nodeId: focusNodeId };
      }
      yield { type: 'run:end', runId };
      return;
    }

    if (!canDelegate) {
      finalRaw = await runOnce(executorFocus, userPrompt, chatHistory);
    } else {
      let prompt = userPrompt;
      let history = chatHistory;
      let executorId = GOD_NODE_ID;

      for (let round = 0; round < MAX_DELEGATE_ROUNDS; round++) {
        throwIfAborted(signal);
        yield { type: 'node:active', nodeId: executorId };
        const reply = await runOnce(executorId, prompt, history);
        const delegate =
          executorId === GOD_NODE_ID ? extractLayercoopDelegate(reply) : null;
        const target =
          delegate && subGods.find((n) => n.id === delegate.targetId);

        if (!delegate || !target || round === MAX_DELEGATE_ROUNDS - 1) {
          finalRaw = reply;
          break;
        }

        const edgeId = edgeOnPathFromGod(graph, target.id);
        if (edgeId) {
          yield { type: 'edge:flow', edgeId };
          await pause(stepMs);
        }
        yield { type: 'node:active', nodeId: target.id };
        const subResult = await runOnce(target.id, delegate.task, []);
        yield { type: 'node:done', nodeId: target.id };

        const label =
          isGodData(target.data) && target.data.label
            ? normalizeGodData(target.data).label
            : target.id;
        executorId = GOD_NODE_ID;
        history = [];
        prompt = [
          `Саб-GOD «${label}» (${target.id}) выполнил задачу:`,
          delegate.task,
          '',
          'Результат:',
          subResult,
          '',
          'Провалидируй результат и ответь пользователю.',
          'Не используй fence layercoop-delegate снова, если задача уже выполнена.',
        ].join('\n');
      }
    }

    const reply = toUserVisibleReply(finalRaw);
    for (const text of chunkTokens(reply)) {
      throwIfAborted(signal);
      yield { type: 'token', text };
      await pause(tokenMs);
    }

    yield { type: 'node:done', nodeId: GOD_NODE_ID };
    if (focusNodeId !== GOD_NODE_ID) {
      yield { type: 'node:done', nodeId: focusNodeId };
    }
    yield { type: 'run:end', runId };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      yield { type: 'run:cancelled', runId };
      return;
    }
    throw err;
  }
}
