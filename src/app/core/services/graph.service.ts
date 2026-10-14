import { Injectable, InjectionToken, Optional, Inject, computed, signal } from '@angular/core';
import {
  ArtifactKind,
  ArtifactNodeData,
  ChatMessage,
  GOD_NODE_ID,
  GodNodeData,
  GraphNode,
  LayercoopGraph,
  NodeGroup,
  PawnLlmConfig,
  defaultGodData,
  defaultPawnLlm,
  isArtifactData,
  isGodData,
  normalizePawnLlm,
} from '../models/graph.model';
import {
  GROUP_CELL_H,
  GROUP_CELL_W,
  applyGroupLayout,
  originFromMemberPositions,
  toggleMultiSelectIds,
} from '../utils/node-group';
import {
  buildExportBundle,
  defaultArtifactPath,
  downloadZip,
  generateArtifactStub,
  triggerDownload,
} from '../utils/export-artifacts';
import {
  WORKSPACE_STORAGE_KEY,
  chatMessagesOf,
  createEmptyThread,
  createNodeChatState,
  loadWorkspace,
  maxArtifactCounter,
  maxGodCounter,
  safeLocalStorage,
  saveWorkspace,
  titleFromChatMessages,
  type ChatThread,
  type NodeChats,
  type StorageLike,
} from '../utils/workspace-persist';
import { promptFromChatMessages } from '../utils/chat-to-node';
import {
  PIPELINE_STATUS_REFRESH_MS,
  buildPipelineStatusRefreshContent,
  extractLayercoopRefresh,
  formatRefreshInterval,
  isPureScheduleAddRequest,
  mergeScheduleIntoPrompt,
  parseAutoRefresh,
} from '../utils/auto-refresh';
import { parseViewListStatus } from '../utils/view-list-status';
import { parseMcpServersFromArtifactContent } from '../runtime/mcp-servers';
import {
  inferArtifactKind,
  isDefaultArtifactLabel,
  suggestArtifactLabel,
} from '../utils/infer-artifact-kind';
import type { WizardDone } from '../utils/node-wizard';
import {
  parseSaveTargetId,
  resolveSaveRoot,
} from '../utils/save-target';
import { resolveConnectedRepos } from '../utils/resolve-repos';
import { ArtifactDiskService } from './artifact-disk.service';
import {
  demoViewFromPrompt,
  parseViewSpec,
  appendChecklistItem,
  removeChecklistItem,
  toggleChecklistItem,
  wantsNodeView,
} from '../utils/node-view';
import type { ViewSpec } from '../models/node-view.model';
import {
  edgeIdBetween,
  findEdgeBetween,
  getConnectedArtifactIds,
  sameUndirectedEdge,
  withSyncedConnectedFlags,
} from '../utils/graph-links';
import { clampArtifactSize } from '../utils/edge-path';
import { isPrimaryGod } from '../utils/god-nodes';

export const WORKSPACE_STORAGE = new InjectionToken<StorageLike>('WORKSPACE_STORAGE');

let nodeCounter = 0;
let godCounter = 0;

let groupCounter = 0;

function createInitialGraph(): LayercoopGraph {
  return {
    version: 1,
    name: 'layercoop-graph',
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: GOD_NODE_ID,
        type: 'god',
        position: { x: 80, y: 120 },
        data: defaultGodData(),
      },
    ],
    edges: [],
  };
}

function maxGroupCounter(graph: LayercoopGraph): number {
  let max = 0;
  for (const g of graph.groups ?? []) {
    const m = /^group-(\d+)$/.exec(g.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function touchGraph(graph: LayercoopGraph): LayercoopGraph {
  return { ...graph, updatedAt: new Date().toISOString() };
}

@Injectable({ providedIn: 'root' })
export class GraphService {
  readonly graph = signal<LayercoopGraph>(createInitialGraph());
  readonly selectedNodeId = signal<string | null>(GOD_NODE_ID);
  /** Ctrl/Cmd+клик: набор для группировки. */
  readonly multiSelectIds = signal<readonly string[]>([]);
  readonly settingsOpen = signal(false);
  /** Инкремент: глобальный чат ставит фокус в поле промпта. */
  readonly chatPromptFocusNonce = signal(0);
  readonly nodeChats = signal<NodeChats>({});
  readonly chatSidebarOpen = signal(true);

  private readonly storage: StorageLike | null;
  private readonly artifactDisk: ArtifactDiskService | null;

  readonly connectedCount = computed(() => getConnectedArtifactIds(this.graph()).size);

  private readonly connectingEdgeIds = signal<ReadonlySet<string>>(new Set());
  private readonly connectingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  /** Источник для режима «Связать…» — следующий клик по ноде завершает связь. */
  readonly linkingFromId = signal<string | null>(null);

  readonly selectedChatMessages = computed(() => {
    const id = this.selectedNodeId();
    if (!id) return [];
    return this.chatMessagesFor(id);
  });

  constructor(
    @Optional() @Inject(WORKSPACE_STORAGE) storage: StorageLike | null = null,
    @Optional() artifactDisk: ArtifactDiskService | null = null,
  ) {
    this.storage = storage ?? safeLocalStorage();
    this.artifactDisk = artifactDisk;
    const snap = loadWorkspace(this.storage);
    if (snap) {
      this.graph.set(withSyncedConnectedFlags(snap.graph));
      this.selectedNodeId.set(snap.selectedNodeId);
      this.nodeChats.set(snap.nodeChats);
      this.chatSidebarOpen.set(snap.chatSidebarOpen !== false);
      nodeCounter = maxArtifactCounter(snap.graph);
      godCounter = maxGodCounter(snap.graph);
      groupCounter = maxGroupCounter(snap.graph);
      this.persist();
    } else if (this.storage && !this.storage.getItem(WORKSPACE_STORAGE_KEY)) {
      this.persist();
    }
  }

  private persist(): void {
    saveWorkspace(this.storage, {
      graph: this.graph(),
      selectedNodeId: this.selectedNodeId(),
      nodeChats: this.nodeChats(),
      chatSidebarOpen: this.chatSidebarOpen(),
    });
  }

  chatMessagesFor(nodeId: string, threadId?: string | null): ChatMessage[] {
    const state = this.nodeChats()[nodeId];
    if (!threadId) return chatMessagesOf(state);
    const thread = state?.threads.find((t) => t.id === threadId);
    return thread?.messages ?? [];
  }

  chatThreadsFor(nodeId: string): ChatThread[] {
    return this.nodeChats()[nodeId]?.threads ?? [];
  }

  activeThreadId(nodeId: string): string | null {
    return this.nodeChats()[nodeId]?.activeThreadId ?? null;
  }

  /** Пишет в указанный тред; без threadId — в active. */
  private mapThread(
    nodeId: string,
    map: (thread: ChatThread) => ChatThread,
    threadId?: string | null,
  ): void {
    this.nodeChats.update((chats) => {
      const state = chats[nodeId] ?? createNodeChatState();
      const threads = state.threads.length ? state.threads : createNodeChatState().threads;
      const activeId = threads.some((t) => t.id === state.activeThreadId)
        ? state.activeThreadId
        : threads[0]!.id;
      const targetId =
        threadId && threads.some((t) => t.id === threadId) ? threadId : activeId;
      const nextThreads = threads.map((t) => (t.id === targetId ? map(t) : t));
      return {
        ...chats,
        [nodeId]: { activeThreadId: activeId, threads: nextThreads },
      };
    });
    this.persist();
  }

  private mapActiveThread(
    nodeId: string,
    map: (thread: ChatThread) => ChatThread,
  ): void {
    this.mapThread(nodeId, map);
  }

  createChatThread(nodeId: string): string {
    const thread = createEmptyThread();
    this.nodeChats.update((chats) => {
      const prev = chats[nodeId];
      const threads = prev?.threads?.length ? [...prev.threads, thread] : [thread];
      return {
        ...chats,
        [nodeId]: { activeThreadId: thread.id, threads },
      };
    });
    this.persist();
    this.chatPromptFocusNonce.update((n) => n + 1);
    return thread.id;
  }

  selectChatThread(nodeId: string, threadId: string): void {
    this.nodeChats.update((chats) => {
      const state = chats[nodeId];
      if (!state?.threads.some((t) => t.id === threadId)) return chats;
      return {
        ...chats,
        [nodeId]: { ...state, activeThreadId: threadId },
      };
    });
    this.persist();
    this.chatPromptFocusNonce.update((n) => n + 1);
  }

  deleteChatThread(nodeId: string, threadId: string): void {
    this.nodeChats.update((chats) => {
      const state = chats[nodeId];
      if (!state) return chats;
      const threads = state.threads.filter((t) => t.id !== threadId);
      if (!threads.length) {
        const fresh = createEmptyThread();
        return { ...chats, [nodeId]: { activeThreadId: fresh.id, threads: [fresh] } };
      }
      const activeThreadId =
        state.activeThreadId === threadId ? threads[threads.length - 1]!.id : state.activeThreadId;
      return { ...chats, [nodeId]: { activeThreadId, threads } };
    });
    this.persist();
  }

  closeChatSidebar(): void {
    this.chatSidebarOpen.set(false);
    this.persist();
  }

  /** Саб-GOD (доп. LLM). linkToPrimary — сразу связать с cursor-god. */
  addGodNode(
    patch: Partial<GodNodeData> = {},
    opts: { linkToPrimary?: boolean } = {},
  ): string {
    const id = `god-${++godCounter}`;
    const gods = this.graph().nodes.filter((n) => n.type === 'god');
    const position = { x: 80 + gods.length * 160, y: 120 };
    const data: GodNodeData = {
      ...defaultGodData(),
      runner: patch.runner ?? 'openai-compatible',
      model: patch.model ?? '',
      baseUrl: patch.baseUrl ?? '',
      apiKey: patch.apiKey ?? '',
      temperature: patch.temperature ?? defaultGodData().temperature,
      isolated: patch.isolated === true,
      label: patch.label?.trim() || patch.model?.trim() || patch.baseUrl?.trim() || 'New LLM',
    };

    const node: GraphNode = { id, type: 'god', position, data };
    this.graph.update((g) => touchGraph({ ...g, nodes: [...g.nodes, node] }));
    if (opts.linkToPrimary) this.linkNodes(GOD_NODE_ID, id);
    this.selectedNodeId.set(id);
    this.settingsOpen.set(false);
    this.chatPromptFocusNonce.update((n) => n + 1);
    this.persist();
    return id;
  }

  /** Без kind — черновик; тип выведется из промпта. С kind — для тестов/совместимости. */
  addArtifactNode(kind?: ArtifactKind): string {
    const id = `artifact-${++nodeCounter}`;
    const row = nodeCounter - 1;
    const position = { x: 280, y: 40 + row * 110 };
    const resolved = kind ?? 'skill';
    const fromMenu = kind !== undefined;

    const data: ArtifactNodeData = {
      kind: resolved,
      label: fromMenu
        ? kind === 'pawn'
          ? 'New pawn LLM'
          : kind === 'repo'
            ? 'Репозиторий'
            : `New ${kind}`
        : 'Новая нода',
      prompt: '',
      connected: false,
      ...(resolved === 'pawn' ? { llm: defaultPawnLlm() } : {}),
      ...(resolved === 'repo' ? { repoPath: '' } : {}),
    };

    const node: GraphNode = { id, type: 'artifact', position, data };

    this.graph.update((g) => touchGraph({ ...g, nodes: [...g.nodes, node] }));
    this.selectedNodeId.set(id);
    this.settingsOpen.set(false);
    this.chatPromptFocusNonce.update((n) => n + 1);
    this.persist();
    return id;
  }

  /**
   * Вынести тред чата на доску: новая artifact-нода с историей, prompt из хвоста,
   * позиция drop и связь с primary GOD.
   */
  spawnArtifactFromChatThread(
    sourceNodeId: string,
    threadId: string,
    position: { x: number; y: number },
  ): string | null {
    const state = this.nodeChats()[sourceNodeId];
    const thread = state?.threads.find((t) => t.id === threadId);
    if (!thread) return null;

    const id = this.addArtifactNode();
    this.updateNodePosition(id, position);

    const rawTitle = thread.title.trim();
    const label =
      !rawTitle || rawTitle === 'Новый чат'
        ? 'Чат'
        : rawTitle.replace(/…$/, '').slice(0, 48);
    this.updateNodeLabel(id, label);
    this.updateNodePrompt(id, promptFromChatMessages(thread.messages));

    const now = new Date().toISOString();
    const messages = thread.messages.map((m) => ({
      ...m,
      steps: m.steps ? m.steps.map((s) => ({ ...s })) : undefined,
    }));
    const seeded = createNodeChatState(messages, now);
    const active = seeded.threads[0]!;
    seeded.threads[0] = {
      ...active,
      title: rawTitle || active.title,
      messages,
      updatedAt: now,
    };

    this.nodeChats.update((chats) => ({ ...chats, [id]: seeded }));
    this.linkNodes(GOD_NODE_ID, id);
    this.persist();
    return id;
  }

  /** Нода, у которой плитка — чеклист (пустой, пункты добавляют руками или LLM). */
  addChecklistNode(): string {
    const id = this.addArtifactNode();
    this.enableChecklistView(id);
    return id;
  }

  addRepoNode(repoPath: string): string {
    const path = repoPath.trim();
    const id = this.addArtifactNode('repo');
    if (path) {
      this.updateRepoPath(id, path);
      const base = path.split(/[/\\]/).filter(Boolean).pop() || 'Репозиторий';
      this.updateNodeLabel(id, base);
    }
    return id;
  }

  updateRepoPath(nodeId: string, repoPath: string): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          if (data.kind !== 'repo') return node;
          return { ...node, data: { ...data, repoPath: repoPath.trim() } };
        }),
      }),
    );
    this.persist();
  }

  enableChecklistView(nodeId: string): void {
    const node = this.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data)) return;
    if (node.data.view?.type === 'checklist') return;
    if (node.data.view) return;
    this.setNodeView(nodeId, { type: 'checklist', items: [] });
    if (isDefaultArtifactLabel(node.data.label)) {
      this.updateNodeLabel(nodeId, 'Чеклист');
    }
  }

  /**
   * Wizard/view из ответа ассистента.
   * Wizard done в чате GOD → новая artifact-нода на доске.
   * Чеклист в чате GOD → новая нода на доске.
   * list/checklist + opts.spawn → новая нода (MR pipeline и т.п.).
   * list/kv/markdown в чате GOD без spawn → не создаём ноду.
   * View в чате artifact без spawn → на эту же ноду.
   */
  applyAssistantArtifacts(
    chatNodeId: string,
    done: WizardDone | null,
    view: ViewSpec | null,
    opts?: { spawn?: boolean },
  ): string | null {
    if (!done && !view) return null;
    const node = this.graph().nodes.find((n) => n.id === chatNodeId);
    if (!node) return null;

    const explicitSpawn =
      opts?.spawn === true &&
      !!view &&
      (view.type === 'list' || view.type === 'checklist');
    const spawnChecklistFromGod = node.type === 'god' && view?.type === 'checklist';
    const spawnWizardFromGod = node.type === 'god' && !!done;
    const spawnNew = explicitSpawn || spawnChecklistFromGod || spawnWizardFromGod;

    if (!spawnNew && node.type !== 'artifact') return null;

    const targetId = spawnNew
      ? view?.type === 'checklist' && !explicitSpawn
        ? this.addChecklistNode()
        : this.addArtifactNode()
      : node.id;

    if (spawnNew) this.connectToGod(targetId);
    if (done) this.applyWizardResult(targetId, done);
    if (view) {
      this.setNodeView(targetId, view);
      if (spawnNew && view.title?.trim()) {
        this.updateNodeLabel(targetId, view.title.trim());
      }
    }
    if (explicitSpawn || (view && this.viewLooksLikeMrPipeline(view))) {
      this.finalizeSpawnedStatusNode(targetId, view);
    }
    return targetId;
  }

  private viewLooksLikeMrPipeline(view: ViewSpec): boolean {
    if (view.type !== 'list') return false;
    const title = view.title ?? '';
    if (/MR\s*!\s*\d+|pipeline/i.test(title)) return true;
    return view.items.some(
      (item) =>
        /^approval$/i.test(item.text.trim()) || parseViewListStatus(item.meta) != null,
    );
  }

  /** Крон 15с + link GitLab MCP + layercoopRefresh, если ещё нет. */
  private finalizeSpawnedStatusNode(nodeId: string, view: ViewSpec | null): void {
    const node = this.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data)) return;
    const data = node.data;
    const title =
      (view && 'title' in view && view.title?.trim()) || data.label || 'Pipeline';

    if (!data.autoRefresh) {
      this.updateNodePrompt(
        nodeId,
        mergeScheduleIntoPrompt(
          data.prompt.trim() || `Статусы ${title}`,
          PIPELINE_STATUS_REFRESH_MS,
        ),
      );
    }

    const gitlabMcps = this.gitlabMcpNodesLinkedToGod();
    for (const mcp of gitlabMcps) {
      if (!this.isLinked(nodeId, mcp.id)) this.linkNodes(nodeId, mcp.id);
    }

    const fresh = this.graph().nodes.find((n) => n.id === nodeId);
    if (!fresh || fresh.type !== 'artifact' || !isArtifactData(fresh.data)) return;
    if (extractLayercoopRefresh(fresh.data.artifactContent)) return;

    const server =
      gitlabMcps
        .map((m) => parseMcpServersFromArtifactContent(m.content)[0]?.name)
        .find((n): n is string => !!n) ?? 'gitlab';
    const refreshOnly = buildPipelineStatusRefreshContent(title, server);
    let nextContent = refreshOnly;
    const existing = fresh.data.artifactContent?.trim();
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const refresh = JSON.parse(refreshOnly) as Record<string, unknown>;
          nextContent = JSON.stringify({ ...parsed, ...refresh }, null, 2);
        }
      } catch {
        // skill markdown и т.п. — кладём только программу refresh (тики важнее)
        nextContent = refreshOnly;
      }
    }
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((n) => {
          if (n.id !== nodeId || n.type !== 'artifact') return n;
          const d = n.data as ArtifactNodeData;
          return { ...n, data: { ...d, artifactContent: nextContent } };
        }),
      }),
    );
    this.persist();
  }

  private gitlabMcpNodesLinkedToGod(): { id: string; content: string }[] {
    const connected = getConnectedArtifactIds(this.graph());
    const out: { id: string; content: string }[] = [];
    for (const n of this.graph().nodes) {
      if (n.type !== 'artifact' || !isArtifactData(n.data)) continue;
      if (n.data.kind !== 'mcp' || !connected.has(n.id)) continue;
      const hay = `${n.data.label} ${n.data.artifactContent ?? ''}`.toLowerCase();
      if (!hay.includes('gitlab') && !hay.includes('git lab')) continue;
      out.push({ id: n.id, content: n.data.artifactContent ?? '' });
    }
    return out;
  }

  /** Fence layercoop-god: primary → новая нода; черновик artifact → промоут в саб-GOD. */
  applyGodSpawn(
    chatNodeId: string,
    spec: {
      label: string;
      runner: GodNodeData['runner'];
      model: string;
      baseUrl: string;
      apiKey?: string;
      apiKeyEnv?: string;
      linkToPrimary: boolean;
    } | null,
  ): string | null {
    if (!spec) return null;
    const patch: Partial<GodNodeData> = {
      label: spec.label,
      runner: spec.runner,
      model: spec.model,
      baseUrl: spec.baseUrl,
      ...(spec.apiKey ? { apiKey: spec.apiKey } : {}),
    };

    if (chatNodeId === GOD_NODE_ID) {
      return this.addGodNode(patch, { linkToPrimary: spec.linkToPrimary });
    }

    const node = this.graph().nodes.find((n) => n.id === chatNodeId);
    if (!node) return null;

    if (node.type === 'god') {
      this.updateGodConfig(patch, chatNodeId);
      if (spec.linkToPrimary && !isPrimaryGod(chatNodeId) && !this.isLinked(GOD_NODE_ID, chatNodeId)) {
        this.linkNodes(GOD_NODE_ID, chatNodeId);
      }
      return chatNodeId;
    }

    if (node.type === 'artifact' && isArtifactData(node.data)) {
      const draft =
        isDefaultArtifactLabel(node.data.label) || !node.data.prompt.trim();
      if (draft) {
        return this.promoteArtifactToGod(chatNodeId, patch, spec.linkToPrimary);
      }
    }

    return this.addGodNode(patch, { linkToPrimary: spec.linkToPrimary });
  }

  /** Заменяет черновик artifact на саб-GOD, сохраняя позицию и рёбра. */
  promoteArtifactToGod(
    artifactId: string,
    patch: Partial<GodNodeData>,
    linkToPrimary: boolean,
  ): string | null {
    const node = this.graph().nodes.find((n) => n.id === artifactId);
    if (!node || node.type !== 'artifact') return null;

    const id = `god-${++godCounter}`;
    const data: GodNodeData = {
      ...defaultGodData(),
      runner: patch.runner ?? 'openai-compatible',
      model: patch.model ?? '',
      baseUrl: patch.baseUrl ?? '',
      apiKey: patch.apiKey ?? '',
      temperature: patch.temperature ?? defaultGodData().temperature,
      isolated: patch.isolated === true,
      label: patch.label?.trim() || 'New LLM',
    };

    this.graph.update((g) =>
      withSyncedConnectedFlags(
        touchGraph({
          ...g,
          nodes: [
            ...g.nodes.filter((n) => n.id !== artifactId),
            { id, type: 'god', position: { ...node.position }, data },
          ],
          edges: g.edges.map((e) => ({
            ...e,
            source: e.source === artifactId ? id : e.source,
            target: e.target === artifactId ? id : e.target,
            id:
              e.source === artifactId || e.target === artifactId
                ? edgeIdBetween(
                    e.source === artifactId ? id : e.source,
                    e.target === artifactId ? id : e.target,
                  )
                : e.id,
          })),
        }),
      ),
    );

    this.nodeChats.update((chats) => {
      if (!(artifactId in chats)) return chats;
      const next = { ...chats };
      next[id] = next[artifactId]!;
      delete next[artifactId];
      return next;
    });

    if (linkToPrimary && !this.isLinked(GOD_NODE_ID, id)) {
      this.linkNodes(GOD_NODE_ID, id);
    }

    this.selectedNodeId.set(id);
    this.settingsOpen.set(true);
    this.persist();
    return id;
  }

  private withInferredKind(data: ArtifactNodeData, prompt: string): ArtifactNodeData {
    // repo задаётся только через toolbar / явный kind — не перетирать из промпта
    if (data.kind === 'repo') {
      return { ...data, prompt };
    }
    const kind = inferArtifactKind(prompt);
    const label = isDefaultArtifactLabel(data.label)
      ? suggestArtifactLabel(prompt, kind)
      : data.label;

    const next: ArtifactNodeData = {
      ...data,
      kind,
      label,
      prompt,
    };
    const autoRefresh = parseAutoRefresh(prompt);
    if (autoRefresh) next.autoRefresh = autoRefresh;
    else delete next.autoRefresh;

    if (kind === 'pawn') {
      next.llm = normalizePawnLlm(data.llm);
    } else {
      delete next.llm;
    }
    if (kind !== 'skill') delete next.pipe;

    // Kind changed → stub устарел
    if (kind !== data.kind) {
      delete next.artifactPath;
      delete next.artifactContent;
    }

    return next;
  }

  removeArtifactNode(nodeId: string): void {
    if (nodeId === GOD_NODE_ID) return;

    if (this.linkingFromId() === nodeId) this.linkingFromId.set(null);

    const existing = this.graph().nodes.find((n) => n.id === nodeId);
    const diskData =
      existing?.type === 'artifact' && isArtifactData(existing.data)
        ? { ...existing.data }
        : null;

    const incident = this.graph().edges.filter(
      (e) => e.source === nodeId || e.target === nodeId,
    );
    for (const e of incident) this.clearEdgeConnecting(e.id);

    this.graph.update((g) =>
      withSyncedConnectedFlags(
        touchGraph(
          this.stripNodeFromGroups(nodeId, {
            ...g,
            nodes: g.nodes.filter((n) => n.id !== nodeId),
            edges: g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
          }),
        ),
      ),
    );
    this.multiSelectIds.update((ids) => ids.filter((id) => id !== nodeId));

    this.nodeChats.update((chats) => {
      if (!(nodeId in chats)) return chats;
      const next = { ...chats };
      delete next[nodeId];
      return next;
    });

    if (this.selectedNodeId() === nodeId) {
      this.selectedNodeId.set(null);
      this.settingsOpen.set(false);
    }

    this.persist();

    if (diskData && this.artifactDisk) {
      void this.artifactDisk.deleteForArtifact(diskData);
    }
  }

  selectNode(nodeId: string | null): void {
    this.multiSelectIds.set([]);
    this.selectedNodeId.set(nodeId);
    if (nodeId) {
      this.chatSidebarOpen.set(true);
      this.ensureDefaultThread(nodeId);
    }
    this.persist();
  }

  clearMultiSelect(): void {
    this.multiSelectIds.set([]);
  }

  isMultiSelected(nodeId: string): boolean {
    return this.multiSelectIds().includes(nodeId);
  }

  groupOf(nodeId: string): NodeGroup | undefined {
    return (this.graph().groups ?? []).find((g) => g.memberIds.includes(nodeId));
  }

  /** Выделить все члены группы ноды на доске (multi-select). */
  selectGroupOf(nodeId: string): boolean {
    const group = this.groupOf(nodeId);
    if (!group || group.memberIds.length < 2) return false;
    this.multiSelectIds.set([...group.memberIds]);
    this.selectedNodeId.set(nodeId);
    this.chatSidebarOpen.set(true);
    this.ensureDefaultThread(nodeId);
    this.persist();
    return true;
  }

  /**
   * Ctrl/Cmd+клик: добавить/убрать ноду из мультивыбора.
   * При ≥2 нодах — создать/обновить группу с сеткой (рёбра не трогаем).
   */
  toggleNodeMultiSelect(nodeId: string): void {
    if (!this.graph().nodes.some((n) => n.id === nodeId)) return;
    const prev = [...this.multiSelectIds()];
    const next = toggleMultiSelectIds(prev, nodeId);
    this.multiSelectIds.set(next);
    this.selectedNodeId.set(nodeId);
    this.chatSidebarOpen.set(true);
    this.ensureDefaultThread(nodeId);

    if (next.length < 2) {
      if (prev.length >= 2) this.removeExactGroup(prev);
      this.persist();
      return;
    }

    this.syncGroupFromMembers(next);
    this.persist();
  }

  ungroup(groupId: string): void {
    this.graph.update((g) => {
      const groups = (g.groups ?? []).filter((gr) => gr.id !== groupId);
      return touchGraph({
        ...g,
        ...(groups.length ? { groups } : { groups: undefined }),
      });
    });
    this.multiSelectIds.set([]);
    this.persist();
  }

  moveGroupBy(groupId: string, dx: number, dy: number): void {
    if (!dx && !dy) return;
    this.graph.update((g) => {
      const group = (g.groups ?? []).find((gr) => gr.id === groupId);
      if (!group) return g;
      const members = new Set(group.memberIds);
      return touchGraph({
        ...g,
        groups: (g.groups ?? []).map((gr) =>
          gr.id === groupId
            ? {
                ...gr,
                position: { x: gr.position.x + dx, y: gr.position.y + dy },
              }
            : gr,
        ),
        nodes: g.nodes.map((n) =>
          members.has(n.id)
            ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            : n,
        ),
      });
    });
    this.persist();
  }

  private removeExactGroup(memberIds: string[]): void {
    const set = new Set(memberIds);
    this.graph.update((g) => {
      const groups = (g.groups ?? []).filter((gr) => {
        const same =
          gr.memberIds.length === set.size && gr.memberIds.every((id) => set.has(id));
        return !same;
      });
      return touchGraph({
        ...g,
        ...(groups.length ? { groups } : { groups: undefined }),
      });
    });
  }

  private syncGroupFromMembers(memberIds: string[]): void {
    const graph = this.graph();
    const positions = memberIds.map((id) => {
      const n = graph.nodes.find((node) => node.id === id);
      return n?.position ?? { x: 0, y: 0 };
    });
    const overlapping = (graph.groups ?? []).filter((gr) =>
      gr.memberIds.some((id) => memberIds.includes(id)),
    );
    const keepId = overlapping[0]?.id ?? `group-${++groupCounter}`;
    const origin = overlapping[0]?.position ?? originFromMemberPositions(positions);
    const laid = applyGroupLayout(origin, memberIds);

    this.graph.update((g) => {
      const otherGroups = (g.groups ?? [])
        .filter((gr) => gr.id !== keepId)
        .map((gr) => ({
          ...gr,
          memberIds: gr.memberIds.filter((id) => !memberIds.includes(id)),
        }))
        .filter((gr) => gr.memberIds.length >= 2);

      const group: NodeGroup = {
        id: keepId,
        memberIds: [...memberIds],
        position: origin,
      };

      const nodes = g.nodes.map((node) => {
        const pos = laid.get(node.id);
        if (!pos) return node;
        if (node.type === 'artifact' && isArtifactData(node.data)) {
          return {
            ...node,
            position: pos,
            data: {
              ...node.data,
              size: { w: GROUP_CELL_W, h: GROUP_CELL_H },
            },
          };
        }
        return { ...node, position: pos };
      });

      return touchGraph({ ...g, nodes, groups: [...otherGroups, group] });
    });
  }

  private stripNodeFromGroups(nodeId: string, g: LayercoopGraph): LayercoopGraph {
    const groups = (g.groups ?? [])
      .map((gr) => ({
        ...gr,
        memberIds: gr.memberIds.filter((id) => id !== nodeId),
      }))
      .filter((gr) => gr.memberIds.length >= 2);
    return {
      ...g,
      ...(groups.length ? { groups } : { groups: undefined }),
    };
  }

  openSettings(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
    this.settingsOpen.set(true);
    this.chatSidebarOpen.set(true);
    this.ensureDefaultThread(nodeId);
    this.persist();
  }

  /** Пустой тред, если у ноды ещё нет чатов — чтобы в UI был select. */
  private ensureDefaultThread(nodeId: string): void {
    if (this.nodeChats()[nodeId]?.threads?.length) return;
    const state = createNodeChatState();
    this.nodeChats.update((chats) => ({ ...chats, [nodeId]: state }));
  }

  openChatSidebar(): void {
    this.chatSidebarOpen.set(true);
    const id = this.selectedNodeId();
    if (id) this.ensureDefaultThread(id);
    this.persist();
  }

  dismissSettings(): void {
    this.settingsOpen.set(false);
  }

  connectToGod(nodeId: string): void {
    this.linkNodes(GOD_NODE_ID, nodeId);
  }

  disconnectFromGod(nodeId: string): void {
    this.unlinkNodes(GOD_NODE_ID, nodeId);
  }

  isLinked(a: string, b: string): boolean {
    return Boolean(findEdgeBetween(this.graph(), a, b));
  }

  neighborsOf(nodeId: string): Array<{ id: string; label: string; type: 'god' | 'artifact' }> {
    const g = this.graph();
    const ids = new Set<string>();
    for (const e of g.edges) {
      if (e.source === nodeId) ids.add(e.target);
      else if (e.target === nodeId) ids.add(e.source);
    }
    return [...ids]
      .map((id) => {
        const node = g.nodes.find((n) => n.id === id);
        if (!node) return null;
        const label =
          node.type === 'god'
            ? (isGodData(node.data) ? node.data.label : 'GOD')
            : isArtifactData(node.data)
              ? node.data.label
              : id;
        return { id, label, type: node.type };
      })
      .filter((x): x is { id: string; label: string; type: 'god' | 'artifact' } => x !== null);
  }

  beginLink(fromId: string): void {
    if (!this.graph().nodes.some((n) => n.id === fromId)) return;
    this.linkingFromId.set(fromId);
  }

  cancelLink(): void {
    this.linkingFromId.set(null);
  }

  completeLink(toId: string): void {
    const fromId = this.linkingFromId();
    this.linkingFromId.set(null);
    if (!fromId || fromId === toId) return;
    this.linkNodes(fromId, toId);
    this.selectNode(toId);
  }

  linkNodes(a: string, b: string): void {
    if (a === b) return;
    const g0 = this.graph();
    if (!g0.nodes.some((n) => n.id === a) || !g0.nodes.some((n) => n.id === b)) return;

    let newlyLinked = false;
    const edgeId = edgeIdBetween(a, b);

    this.graph.update((g) => {
      if (findEdgeBetween(g, a, b)) {
        return withSyncedConnectedFlags(g);
      }
      newlyLinked = true;
      const edges = [...g.edges, { id: edgeId, source: a, target: b }];
      return withSyncedConnectedFlags(touchGraph({ ...g, edges }));
    });
    this.persist();
    if (newlyLinked) this.pulseEdgeConnecting(edgeId);
  }

  unlinkNodes(a: string, b: string): void {
    if (a === b) return;
    const existing = findEdgeBetween(this.graph(), a, b);
    if (existing) this.clearEdgeConnecting(existing.id);

    this.graph.update((g) => {
      const edges = g.edges.filter((e) => !sameUndirectedEdge(e, a, b));
      return withSyncedConnectedFlags(touchGraph({ ...g, edges }));
    });
    this.persist();
  }

  /** Связать, если нет ребра; иначе разорвать. */
  toggleLink(a: string, b: string): void {
    if (a === b) return;
    if (this.isLinked(a, b)) this.unlinkNodes(a, b);
    else this.linkNodes(a, b);
  }

  removeEdge(edgeId: string): void {
    const edge = this.graph().edges.find((e) => e.id === edgeId);
    if (!edge) return;
    this.unlinkNodes(edge.source, edge.target);
  }

  isEdgeConnecting(edgeId: string): boolean {
    return this.connectingEdgeIds().has(edgeId);
  }

  isNodeLinking(nodeId: string): boolean {
    const connecting = this.connectingEdgeIds();
    if (connecting.size === 0) return false;
    return this.graph().edges.some(
      (e) =>
        connecting.has(e.id) && (e.source === nodeId || e.target === nodeId),
    );
  }

  private pulseEdgeConnecting(edgeId: string): void {
    this.clearEdgeConnecting(edgeId);
    this.connectingEdgeIds.update((s) => new Set([...s, edgeId]));
    const timeout = setTimeout(() => this.clearEdgeConnecting(edgeId), 1500);
    this.connectingTimeouts.set(edgeId, timeout);
  }

  private clearEdgeConnecting(edgeId: string): void {
    const prev = this.connectingTimeouts.get(edgeId);
    if (prev !== undefined) {
      clearTimeout(prev);
      this.connectingTimeouts.delete(edgeId);
    }
    this.connectingEdgeIds.update((s) => {
      if (!s.has(edgeId)) return s;
      const next = new Set(s);
      next.delete(edgeId);
      return next;
    });
  }

  updateNodePrompt(nodeId: string, prompt: string): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          if (!prompt.trim()) {
            return { ...node, data: { ...data, prompt } };
          }
          return { ...node, data: this.withInferredKind(data, prompt) };
        }),
      }),
    );
    this.persist();
  }

  /**
   * Чистый запрос «добавь крон» на существующий skill/agent/rule/pawn —
   * патчит prompt текущей ноды (бейдж), без LLM и без новых MCP.
   */
  applyFocusSchedulePatch(
    nodeId: string,
    userText: string,
  ): { intervalMs: number; localOnly: true; label: string } | null {
    const node = this.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data)) return null;
    const data = node.data;
    if (data.kind === 'repo' || data.kind === 'mcp') return null;
    const existing = data.prompt.trim().length >= 8 || !isDefaultArtifactLabel(data.label);
    if (!existing) return null;

    const spec = isPureScheduleAddRequest(userText);
    if (!spec) return null;

    const next = mergeScheduleIntoPrompt(data.prompt, spec.intervalMs);
    this.updateNodePrompt(nodeId, next);
    return { intervalMs: spec.intervalMs, localOnly: true, label: data.label };
  }

  /** Текст подтверждения локального патча крона. */
  focusSchedulePatchReply(intervalMs: number, label: string): string {
    return `Крон «${formatRefreshInterval(intervalMs)}» добавлен на ноду «${label}». Бейдж на плитке обновлён; отдельные MCP не создавались.`;
  }

  updatePawnLlm(nodeId: string, patch: Partial<PawnLlmConfig>): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          if (data.kind !== 'pawn') return node;
          const current = normalizePawnLlm(data.llm);
          return { ...node, data: { ...data, llm: { ...current, ...patch } } };
        }),
      }),
    );
    this.persist();
  }

  updateNodeLabel(nodeId: string, label: string): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          return { ...node, data: { ...data, label } };
        }),
      }),
    );
    this.persist();
  }

  /** Галочка «Пайп» на skill — появляется в ПКМ-меню. */
  setArtifactPipe(nodeId: string, pipe: boolean): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          if (data.kind !== 'skill') return node;
          const next: ArtifactNodeData = { ...data };
          if (pipe) next.pipe = true;
          else delete next.pipe;
          return { ...node, data: next };
        }),
      }),
    );
    this.persist();
  }

  applyWizardResult(nodeId: string, result: WizardDone): void {
    const repos = resolveConnectedRepos(this.graph()).nodes;
    const saveRoot = resolveSaveRoot(parseSaveTargetId(result.saveTarget), repos);
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          const inferred = this.withInferredKind(data, result.prompt);
          const kind = result.kind ?? inferred.kind;
          const next: ArtifactNodeData = {
            ...inferred,
            kind,
            label: result.label,
            prompt: result.prompt,
          };
          if (kind === 'pawn') next.llm = normalizePawnLlm(data.llm ?? inferred.llm);
          else delete next.llm;
          if (kind !== data.kind) {
            delete next.artifactPath;
            delete next.artifactContent;
          }
          if (result.saveTarget) {
            if (saveRoot) next.saveRoot = saveRoot;
            else delete next.saveRoot;
          }
          return { ...node, data: next };
        }),
      }),
    );
    this.persist();
  }

  /** Выбор места сохранения из wizard option (save:home / save:repo:…). */
  applySaveTargetPick(nodeId: string, optionId: string): void {
    const repos = resolveConnectedRepos(this.graph()).nodes;
    const target = parseSaveTargetId(optionId);
    if (!target) return;
    const saveRoot = resolveSaveRoot(target, repos);
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          const next = { ...data };
          if (saveRoot) next.saveRoot = saveRoot;
          else delete next.saveRoot;
          return { ...node, data: next };
        }),
      }),
    );
    this.persist();
  }

  setNodeView(nodeId: string, view: ViewSpec | null): void {
    const parsed = view ? parseViewSpec(view) : null;
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          const next = { ...data };
          if (parsed) next.view = parsed;
          else delete next.view;
          return { ...node, data: next };
        }),
      }),
    );
    this.persist();
  }

  clearNodeView(nodeId: string): void {
    this.setNodeView(nodeId, null);
  }

  toggleChecklistItem(nodeId: string, itemId: string): void {
    const node = this.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data)) return;
    const view = node.data.view;
    if (!view || view.type !== 'checklist') return;
    const next = toggleChecklistItem(view, itemId);
    if (next === view) return;
    this.setNodeView(nodeId, next);
  }

  addChecklistItem(nodeId: string, text: string): void {
    const node = this.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data)) return;
    const next = appendChecklistItem(node.data.view, text);
    if (!next || next === node.data.view) return;
    this.setNodeView(nodeId, next);
  }

  removeChecklistItem(nodeId: string, itemId: string): void {
    const node = this.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data)) return;
    const view = node.data.view;
    if (!view || view.type !== 'checklist') return;
    const next = removeChecklistItem(view, itemId);
    if (next === view) return;
    this.setNodeView(nodeId, next);
  }

  setNodeSize(nodeId: string, size: { w: number; h: number }): void {
    const clamped = clampArtifactSize(size);
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          return { ...node, data: { ...data, size: clamped } };
        }),
      }),
    );
    this.persist();
  }

  generateArtifact(nodeId: string): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'artifact') return node;
          const data = node.data as ArtifactNodeData;
          const inferred = data.prompt.trim()
            ? this.withInferredKind(data, data.prompt)
            : data;
          const next: ArtifactNodeData = {
            ...inferred,
            artifactPath: defaultArtifactPath(inferred.kind, inferred.label),
            artifactContent: generateArtifactStub(
              inferred.kind,
              inferred.label,
              inferred.prompt,
              inferred.llm,
            ),
          };
          if (wantsNodeView(inferred.prompt)) {
            next.view = demoViewFromPrompt(inferred.prompt);
          }
          return { ...node, data: next };
        }),
      }),
    );
    this.persist();
  }

  updateGodConfig(patch: Partial<GodNodeData>, nodeId: string = GOD_NODE_ID): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'god') return node;
          const current = isGodData(node.data) ? node.data : defaultGodData();
          return { ...node, data: { ...current, ...patch } };
        }),
      }),
    );
    this.persist();
  }

  updateNodePosition(nodeId: string, position: { x: number; y: number }): void {
    this.graph.update((g) =>
      touchGraph({
        ...g,
        nodes: g.nodes.map((node) =>
          node.id === nodeId ? { ...node, position } : node,
        ),
      }),
    );
    this.persist();
  }

  pushChatMessage(
    nodeId: string,
    message: ChatMessage,
    threadId?: string | null,
  ): void {
    this.mapThread(
      nodeId,
      (thread) => {
        const messages = [...thread.messages, message];
        const title =
          thread.title === 'Новый чат' ? titleFromChatMessages(messages) : thread.title;
        return {
          ...thread,
          title,
          messages,
          updatedAt: message.timestamp || new Date().toISOString(),
        };
      },
      threadId,
    );
  }

  appendChatContent(
    nodeId: string,
    messageId: string,
    chunk: string,
    threadId?: string | null,
  ): void {
    this.mapThread(
      nodeId,
      (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === messageId ? { ...m, content: m.content + chunk } : m,
        ),
        updatedAt: new Date().toISOString(),
      }),
      threadId,
    );
  }

  replaceChatContent(
    nodeId: string,
    messageId: string,
    content: string,
    threadId?: string | null,
  ): void {
    this.mapThread(
      nodeId,
      (thread) => ({
        ...thread,
        messages: thread.messages.map((m) => (m.id === messageId ? { ...m, content } : m)),
        updatedAt: new Date().toISOString(),
      }),
      threadId,
    );
  }

  setChatSteps(
    nodeId: string,
    messageId: string,
    steps: ChatMessage['steps'],
    threadId?: string | null,
  ): void {
    this.mapThread(
      nodeId,
      (thread) => ({
        ...thread,
        messages: thread.messages.map((m) => (m.id === messageId ? { ...m, steps } : m)),
        updatedAt: new Date().toISOString(),
      }),
      threadId,
    );
  }

  setChatStats(
    nodeId: string,
    messageId: string,
    stats: ChatMessage['stats'],
    threadId?: string | null,
  ): void {
    this.mapThread(
      nodeId,
      (thread) => ({
        ...thread,
        messages: thread.messages.map((m) => (m.id === messageId ? { ...m, stats } : m)),
        updatedAt: new Date().toISOString(),
      }),
      threadId,
    );
  }

  setGraphName(name: string): void {
    this.graph.update((g) => touchGraph({ ...g, name }));
    this.persist();
  }

  isConnected(nodeId: string): boolean {
    return getConnectedArtifactIds(this.graph()).has(nodeId);
  }

  isDirectlyLinkedToGod(nodeId: string): boolean {
    return Boolean(findEdgeBetween(this.graph(), GOD_NODE_ID, nodeId));
  }

  async exportZip(): Promise<void> {
    const graph = this.graph();
    const bundle = buildExportBundle(graph);
    const blob = await downloadZip(bundle.files);
    triggerDownload(blob, `${graph.name}-layercoop.zip`);
  }
}
