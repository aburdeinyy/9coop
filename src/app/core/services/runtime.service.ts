import { Injectable, computed, inject, signal } from '@angular/core';
import { GraphService } from './graph.service';
import { SecretsService } from './secrets.service';
import { RepoGitService } from './repo-git.service';
import {
  GOD_NODE_ID,
  isArtifactData,
  isGodData,
  normalizeGodData,
} from '../models/graph.model';
import type { ChatRunStats, ChatRunStep } from '../models/graph.model';
import type { RuntimeEvent } from '../runtime/runtime-events';
import { runRuntime } from '../runtime/runtime-engine';
import {
  extractLayercoopViewFence,
  materializeViewFenceForChat,
  stripLayercoopViewFence,
} from '../utils/node-view';
import { extractWizardDone, stripWizardFenceIfDone } from '../utils/node-wizard';
import {
  extractLayercoopGod,
  stripLayercoopDelegateFence,
  stripLayercoopGodFence,
  type GodSpawnSpec,
} from '../utils/god-delegate';
import { finalizeRunSteps, reduceRunSteps } from '../utils/run-steps';
import { mergeRunStats } from '../utils/run-stats';
import {
  reduceContextVisual,
  type ContextVisualState,
} from '../utils/run-context-visual';
import { chatScopeKey } from '../utils/chat-scope';
import { buildPipeRunPrompt, listPipeSkills } from '../utils/pipe-skills';

export type RuntimeRunOpts = {
  forceArtifactIds?: string[];
};

const CANCELLED_MARK = '⏹ Остановлено';

@Injectable({ providedIn: 'root' })
export class RuntimeService {
  private readonly graphService = inject(GraphService);
  private readonly secrets = inject(SecretsService);
  private readonly repoGit = inject(RepoGitService);
  /** Параллельные раны: scopeKey → AbortController */
  private readonly aborts = new Map<string, AbortController>();

  readonly activeNodeIds = signal<ReadonlySet<string>>(new Set());
  readonly flowingEdgeIds = signal<ReadonlySet<string>>(new Set());
  readonly contextNodeIds = signal<ReadonlySet<string>>(new Set());
  readonly contextEdgeIds = signal<ReadonlySet<string>>(new Set());
  readonly lastToolCall = signal<string | null>(null);
  readonly runningChatKeys = signal<ReadonlySet<string>>(new Set());
  /** Последний стартовавший чат (для совместимости UI). */
  readonly runningNodeId = signal<string | null>(null);

  readonly isRunning = computed(() => this.runningChatKeys().size > 0);

  isChatRunning(nodeId: string, threadId?: string | null): boolean {
    const tid = threadId ?? this.graphService.activeThreadId(nodeId);
    return this.runningChatKeys().has(chatScopeKey(nodeId, tid));
  }

  isNodeRunning(nodeId: string): boolean {
    const prefix = `${nodeId}::`;
    for (const key of this.runningChatKeys()) {
      if (key.startsWith(prefix) || key === `${nodeId}::`) return true;
    }
    return false;
  }

  isNodeActive(nodeId: string): boolean {
    return this.activeNodeIds().has(nodeId);
  }

  isNodeInContext(nodeId: string): boolean {
    return this.contextNodeIds().has(nodeId);
  }

  isEdgeFlowing(edgeId: string): boolean {
    return this.flowingEdgeIds().has(edgeId);
  }

  isEdgeInContext(edgeId: string): boolean {
    return this.contextEdgeIds().has(edgeId);
  }

  private applyContextVisual(event: RuntimeEvent): void {
    const next: ContextVisualState = reduceContextVisual(
      { nodeIds: this.contextNodeIds(), edgeIds: this.contextEdgeIds() },
      event,
    );
    this.contextNodeIds.set(next.nodeIds);
    this.contextEdgeIds.set(next.edgeIds);
  }

  /** Стоп рана выбранного чата (или nodeId+thread). */
  stop(nodeId?: string, threadId?: string | null): void {
    const id = nodeId ?? this.graphService.selectedNodeId() ?? undefined;
    if (!id) return;
    const tid = threadId ?? this.graphService.activeThreadId(id);
    const key = chatScopeKey(id, tid);
    this.aborts.get(key)?.abort();
  }

  /** Запуск пайпа (skill без рёбер) на focus-ноде через GOD. */
  async runPipe(focusNodeId: string, pipeId: string): Promise<void> {
    const pipe = listPipeSkills(this.graphService.graph()).find((p) => p.id === pipeId);
    if (!pipe) return;
    this.graphService.selectNode(focusNodeId);
    const node = this.graphService.graph().nodes.find((n) => n.id === focusNodeId);
    let focusLabel = 'нода';
    if (node?.type === 'artifact' && isArtifactData(node.data)) {
      focusLabel = node.data.label;
    } else if (node?.type === 'god' && isGodData(node.data)) {
      focusLabel = normalizeGodData(node.data).label;
    }
    await this.run(buildPipeRunPrompt(pipe, focusLabel), focusNodeId, {
      forceArtifactIds: [pipeId],
    });
  }

  async run(
    userPrompt: string,
    nodeId?: string,
    opts: RuntimeRunOpts = {},
  ): Promise<void> {
    const trimmed = userPrompt.trim();
    if (!trimmed) return;

    const targetId =
      nodeId ?? this.graphService.selectedNodeId() ?? GOD_NODE_ID;
    const threadId = this.graphService.activeThreadId(targetId);
    const scopeKey = chatScopeKey(targetId, threadId);

    if (this.runningChatKeys().has(scopeKey)) return;

    const schedulePatch = this.graphService.applyFocusSchedulePatch(targetId, trimmed);
    if (schedulePatch?.localOnly) {
      const now = new Date().toISOString();
      const userId = `msg-${Date.now()}`;
      this.graphService.pushChatMessage(
        targetId,
        {
          id: userId,
          role: 'user',
          content: trimmed,
          timestamp: now,
        },
        threadId,
      );
      this.graphService.pushChatMessage(
        targetId,
        {
          id: `${userId}-assistant`,
          role: 'assistant',
          content: this.graphService.focusSchedulePatchReply(
            schedulePatch.intervalMs,
            schedulePatch.label,
          ),
          timestamp: now,
        },
        threadId,
      );
      return;
    }

    const controller = new AbortController();
    this.aborts.set(scopeKey, controller);
    this.runningChatKeys.update((s) => new Set(s).add(scopeKey));
    this.runningNodeId.set(targetId);
    this.lastToolCall.set(null);

    const now = new Date().toISOString();
    const userId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const assistantId = `${userId}-assistant`;

    const priorHistory = this.graphService.chatMessagesFor(targetId, threadId);

    this.graphService.pushChatMessage(
      targetId,
      {
        id: userId,
        role: 'user',
        content: trimmed,
        timestamp: now,
      },
      threadId,
    );
    this.graphService.pushChatMessage(
      targetId,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: now,
        steps: [],
      },
      threadId,
    );

    let steps: ChatRunStep[] = [];
    let runStats: ChatRunStats | undefined;
    const startedAt = Date.now();

    try {
      for await (const event of runRuntime(this.graphService.graph(), trimmed, {
        focusNodeId: targetId,
        chatHistory: priorHistory,
        signal: controller.signal,
        forceArtifactIds: opts.forceArtifactIds,
      })) {
        this.applyContextVisual(event);
        if (event.type === 'run:cancelled') {
          this.markCancelled(targetId, assistantId, threadId);
          break;
        }
        if (event.type === 'run:stats') {
          runStats = mergeRunStats(runStats, event.stats);
          continue;
        }
        if (event.type === 'run:context') continue;
        steps = this.applyEvent(event, targetId, assistantId, steps, threadId);
      }
      if (steps.length) {
        steps = finalizeRunSteps(steps);
        this.graphService.setChatSteps(targetId, assistantId, steps, threadId);
      }
      if (!controller.signal.aborted) {
        await this.applyAssistantFencesFromAssistant(targetId, assistantId, threadId);
      }
    } finally {
      const wallMs = Date.now() - startedAt;
      const finalStats: ChatRunStats = {
        durationMs: runStats?.durationMs && runStats.durationMs > 0 ? runStats.durationMs : wallMs,
        ...(runStats?.usage ? { usage: runStats.usage } : {}),
      };
      if (finalStats.durationMs > 0 || finalStats.usage) {
        this.graphService.setChatStats(targetId, assistantId, finalStats, threadId);
      }
      if (this.aborts.get(scopeKey) === controller) this.aborts.delete(scopeKey);
      this.runningChatKeys.update((s) => {
        const next = new Set(s);
        next.delete(scopeKey);
        return next;
      });
      if (this.runningNodeId() === targetId && !this.isNodeRunning(targetId)) {
        this.runningNodeId.set(
          [...this.runningChatKeys()]
            .map((k) => k.split('::')[0] ?? null)
            .find(Boolean) ?? null,
        );
      }
      if (this.runningChatKeys().size === 0) {
        this.activeNodeIds.set(new Set());
        this.flowingEdgeIds.set(new Set());
        this.contextNodeIds.set(new Set());
        this.contextEdgeIds.set(new Set());
        this.lastToolCall.set(null);
        this.runningNodeId.set(null);
      }
      if (steps.length) {
        this.graphService.setChatSteps(
          targetId,
          assistantId,
          finalizeRunSteps(steps),
          threadId,
        );
      }
      void this.repoGit.refreshConnected();
    }
  }

  private markCancelled(
    chatNodeId: string,
    assistantId: string,
    threadId?: string | null,
  ): void {
    const msg = this.graphService
      .chatMessagesFor(chatNodeId, threadId)
      .find((m) => m.id === assistantId);
    const content = msg?.content?.trim() ?? '';
    if (!content) {
      this.graphService.replaceChatContent(
        chatNodeId,
        assistantId,
        CANCELLED_MARK,
        threadId,
      );
      return;
    }
    if (!content.includes(CANCELLED_MARK)) {
      this.graphService.appendChatContent(
        chatNodeId,
        assistantId,
        `\n\n${CANCELLED_MARK}`,
        threadId,
      );
    }
  }

  /** Wizard + layercoop-view + layercoop-god: на artifact — на неё; view/чеклист/god в GOD — новые ноды. */
  async applyAssistantFencesFromAssistant(
    chatNodeId: string,
    assistantId: string,
    threadId?: string | null,
  ): Promise<void> {
    const msg = this.graphService
      .chatMessagesFor(chatNodeId, threadId)
      .find((m) => m.id === assistantId);
    if (!msg?.content) return;

    const done = extractWizardDone(msg.content);
    const extractedView = extractLayercoopViewFence(msg.content);
    const view = extractedView?.view ?? null;
    let godSpawn = extractLayercoopGod(msg.content);
    if (godSpawn) {
      godSpawn = await this.withSecretApiKey(godSpawn);
    }

    const appliedViewId = this.graphService.applyAssistantArtifacts(
      chatNodeId,
      done,
      view,
      extractedView?.spawn ? { spawn: true } : undefined,
    );
    this.graphService.applyGodSpawn(chatNodeId, godSpawn);

    let stripped = stripLayercoopGodFence(
      stripLayercoopDelegateFence(stripWizardFenceIfDone(msg.content)),
    );
    if (appliedViewId && view) {
      stripped = stripLayercoopViewFence(stripped);
      if (view.type === 'checklist') {
        const title = view.title?.trim();
        const tip = title
          ? `\n\n→ чеклист на плитке «${title}» на доске.`
          : `\n\n→ чеклист на плитке на доске.`;
        if (!stripped.includes('→ чеклист на плитке')) {
          stripped = `${stripped}${tip}`.trim();
        }
      }
    } else if (view) {
      stripped = materializeViewFenceForChat(stripped);
    }
    if (stripped !== msg.content) {
      this.graphService.replaceChatContent(chatNodeId, assistantId, stripped, threadId);
    }
  }

  private async withSecretApiKey(spec: GodSpawnSpec): Promise<GodSpawnSpec> {
    if (spec.apiKey?.trim() || !spec.apiKeyEnv?.trim()) return spec;
    try {
      await this.secrets.reload();
    } catch {
      /* bridge offline — apiKey останется пустым, пользователь вставит в UI */
    }
    const value = this.secrets.valueFor(spec.apiKeyEnv);
    if (!value) return spec;
    return { ...spec, apiKey: value };
  }

  private applyEvent(
    event: RuntimeEvent,
    chatNodeId: string,
    assistantId: string,
    steps: ChatRunStep[],
    threadId?: string | null,
  ): ChatRunStep[] {
    switch (event.type) {
      case 'node:active':
        this.activeNodeIds.update((s) => new Set(s).add(event.nodeId));
        return steps;
      case 'node:done':
        this.activeNodeIds.update((s) => {
          const next = new Set(s);
          next.delete(event.nodeId);
          return next;
        });
        this.flowingEdgeIds.update((s) => {
          const next = new Set(s);
          for (const id of next) {
            if (id.includes(event.nodeId)) next.delete(id);
          }
          return next;
        });
        return steps;
      case 'edge:flow':
        this.flowingEdgeIds.update((s) => new Set(s).add(event.edgeId));
        return steps;
      case 'tool:call': {
        if (event.status === 'start') {
          this.lastToolCall.set(event.detail?.trim() || event.name);
        }
        if (event.status === 'start') {
          this.activeNodeIds.update((s) => new Set(s).add(event.nodeId));
        } else {
          this.activeNodeIds.update((s) => {
            const next = new Set(s);
            if (event.nodeId !== GOD_NODE_ID) next.delete(event.nodeId);
            return next;
          });
        }
        const nextSteps = reduceRunSteps(steps, {
          type: 'tool',
          name: event.name,
          status: event.status,
          callId: event.callId,
          detail: event.detail,
        });
        this.graphService.setChatSteps(chatNodeId, assistantId, nextSteps, threadId);
        return nextSteps;
      }
      case 'token': {
        if (event.toChat !== false) {
          this.graphService.appendChatContent(
            chatNodeId,
            assistantId,
            event.text,
            threadId,
          );
        }
        const nextSteps = reduceRunSteps(steps, { type: 'token', text: event.text });
        this.graphService.setChatSteps(chatNodeId, assistantId, nextSteps, threadId);
        return nextSteps;
      }
      default:
        return steps;
    }
  }
}
