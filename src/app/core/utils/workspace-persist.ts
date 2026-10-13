import type { ChatMessage, LayercoopGraph } from '../models/graph.model';
import { normalizeNodeGroups } from './node-group';
import { GOD_NODE_ID, isGodData, normalizeArtifactData, normalizeGodData } from '../models/graph.model';
import { normalizeChatRunStats } from './run-stats';

export const WORKSPACE_STORAGE_KEY = 'layercoop.workspace.v1';

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface NodeChatState {
  activeThreadId: string;
  threads: ChatThread[];
}

export type NodeChats = Record<string, NodeChatState>;

export interface WorkspaceSnapshot {
  version: 1;
  graph: LayercoopGraph;
  selectedNodeId: string | null;
  nodeChats: NodeChats;
  sidebarWidth?: number;
  pan?: { x: number; y: number };
  zoom?: number;
  /** Блюр-аура под нодами на доске. По умолчанию включена. */
  boardAuraEnabled?: boolean;
  /** Правый чат открыт. По умолчанию true. */
  chatSidebarOpen?: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__layercoop_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function maxArtifactCounter(graph: LayercoopGraph): number {
  let max = 0;
  for (const node of graph.nodes) {
    const match = /^artifact-(\d+)$/.exec(node.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function maxGodCounter(graph: LayercoopGraph): number {
  let max = 0;
  for (const node of graph.nodes) {
    const match = /^god-(\d+)$/.exec(node.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteCoord(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Минимальный граф с GOD — чтобы partial save (pan/zoom) не оставлял нечитаемый snapshot. */
function fallbackGraph(): LayercoopGraph {
  return {
    version: 1,
    name: 'layercoop-graph',
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: GOD_NODE_ID,
        type: 'god',
        position: { x: 80, y: 120 },
        data: normalizeGodData({}),
      },
    ],
    edges: [],
  };
}

function normalizeGraph(raw: unknown): LayercoopGraph | null {
  if (!isRecord(raw)) return null;
  if (raw['version'] !== 1) return null;
  if (typeof raw['name'] !== 'string') return null;
  if (!Array.isArray(raw['nodes']) || !Array.isArray(raw['edges'])) return null;

  const nodes = raw['nodes'].map((node) => {
    if (!isRecord(node)) return null;
    if (typeof node['id'] !== 'string') return null;
    if (node['type'] !== 'god' && node['type'] !== 'artifact') return null;
    const pos = isRecord(node['position']) ? node['position'] : {};
    const x = finiteCoord(pos['x']);
    const y = finiteCoord(pos['y']);
    const data = node['data'];
    if (!isRecord(data)) return null;
    const normalizedData =
      node['id'] === GOD_NODE_ID || node['type'] === 'god' || isGodData(data as never)
        ? normalizeGodData(data as never)
        : normalizeArtifactData(data);
    return {
      id: node['id'] as string,
      type: node['type'] as 'god' | 'artifact',
      position: { x, y },
      data: normalizedData as LayercoopGraph['nodes'][number]['data'],
    };
  });

  if (nodes.some((n) => n === null)) return null;
  const typedNodes = nodes as LayercoopGraph['nodes'];
  if (!typedNodes.some((n) => n.id === GOD_NODE_ID && n.type === 'god')) return null;

  const edges = raw['edges'].map((edge) => {
    if (!isRecord(edge)) return null;
    if (
      typeof edge['id'] !== 'string' ||
      typeof edge['source'] !== 'string' ||
      typeof edge['target'] !== 'string'
    ) {
      return null;
    }
    return {
      id: edge['id'] as string,
      source: edge['source'] as string,
      target: edge['target'] as string,
    };
  });
  if (edges.some((e) => e === null)) return null;

  const validIds = new Set(typedNodes.map((n) => n.id));
  const groups = normalizeNodeGroups(raw['groups'], validIds);

  return {
    version: 1,
    name: raw['name'] as string,
    updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : new Date().toISOString(),
    nodes: typedNodes,
    edges: edges as LayercoopGraph['edges'],
    ...(groups.length ? { groups } : {}),
  };
}

function normalizeChatSteps(raw: unknown): ChatMessage['steps'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<ChatMessage['steps']> = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item['id'] !== 'string') continue;
    if (item['kind'] !== 'thought' && item['kind'] !== 'tool') continue;
    if (typeof item['label'] !== 'string') continue;
    if (typeof item['text'] !== 'string') continue;
    if (item['status'] !== 'running' && item['status'] !== 'done') continue;
    out.push({
      id: item['id'],
      kind: item['kind'],
      label: item['label'],
      text: item['text'],
      status: item['status'],
    });
  }
  return out.length ? out : undefined;
}

function normalizeChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item['id'] !== 'string') continue;
    if (item['role'] !== 'user' && item['role'] !== 'assistant') continue;
    if (typeof item['content'] !== 'string') continue;
    if (typeof item['timestamp'] !== 'string') continue;
    const steps = normalizeChatSteps(item['steps']);
    const stats = normalizeChatRunStats(item['stats']);
    out.push({
      id: item['id'],
      role: item['role'],
      content: item['content'],
      timestamp: item['timestamp'],
      ...(steps ? { steps } : {}),
      ...(stats ? { stats } : {}),
    });
  }
  return out;
}

export function titleFromChatMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!first) return 'Новый чат';
  const t = first.content.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

export function createEmptyThread(now = new Date().toISOString()): ChatThread {
  const id = `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: 'Новый чат',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function createNodeChatState(
  messages: ChatMessage[] = [],
  now = new Date().toISOString(),
): NodeChatState {
  const thread: ChatThread = {
    ...createEmptyThread(now),
    title: titleFromChatMessages(messages),
    messages,
  };
  return { activeThreadId: thread.id, threads: [thread] };
}

export function chatMessagesOf(state: NodeChatState | undefined): ChatMessage[] {
  if (!state?.threads?.length) return [];
  const active =
    state.threads.find((t) => t.id === state.activeThreadId) ?? state.threads[0];
  return active?.messages ?? [];
}

function normalizeChatThread(raw: unknown): ChatThread | null {
  if (!isRecord(raw) || typeof raw['id'] !== 'string') return null;
  const messages = normalizeChatMessages(raw['messages']);
  const createdAt =
    typeof raw['createdAt'] === 'string' ? raw['createdAt'] : new Date().toISOString();
  const updatedAt = typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : createdAt;
  const title =
    typeof raw['title'] === 'string' && raw['title'].trim()
      ? raw['title']
      : titleFromChatMessages(messages);
  return { id: raw['id'], title, createdAt, updatedAt, messages };
}

export function normalizeNodeChatState(raw: unknown): NodeChatState | null {
  if (Array.isArray(raw)) {
    const messages = normalizeChatMessages(raw);
    if (!messages.length) return null;
    return createNodeChatState(messages);
  }
  if (!isRecord(raw) || !Array.isArray(raw['threads'])) return null;
  const threads = raw['threads']
    .map(normalizeChatThread)
    .filter((t): t is ChatThread => !!t);
  if (!threads.length) return null;
  const activeThreadId =
    typeof raw['activeThreadId'] === 'string' &&
    threads.some((t) => t.id === raw['activeThreadId'])
      ? (raw['activeThreadId'] as string)
      : threads[0]!.id;
  return { activeThreadId, threads };
}

export function normalizeNodeChats(raw: unknown, legacyMessages?: unknown): NodeChats {
  const out: NodeChats = {};
  if (isRecord(raw)) {
    for (const [nodeId, entry] of Object.entries(raw)) {
      const state = normalizeNodeChatState(entry);
      if (state) out[nodeId] = state;
    }
  }
  if (Object.keys(out).length === 0) {
    const legacy = normalizeChatMessages(legacyMessages);
    if (legacy.length) out[GOD_NODE_ID] = createNodeChatState(legacy);
  }
  return out;
}

export function parseWorkspace(raw: string | null | undefined): WorkspaceSnapshot | null {
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(raw);
    if (!isRecord(json) || json['version'] !== 1) return null;
    const graph = normalizeGraph(json['graph']);
    if (!graph) return null;

    const selectedNodeId =
      json['selectedNodeId'] === null
        ? null
        : typeof json['selectedNodeId'] === 'string'
          ? json['selectedNodeId']
          : GOD_NODE_ID;

    const sidebarWidth =
      typeof json['sidebarWidth'] === 'number' && Number.isFinite(json['sidebarWidth'])
        ? json['sidebarWidth']
        : undefined;

    let pan: { x: number; y: number } | undefined;
    if (isRecord(json['pan'])) {
      const x = json['pan']['x'];
      const y = json['pan']['y'];
      if (typeof x === 'number' && typeof y === 'number') pan = { x, y };
    }

    const zoom =
      typeof json['zoom'] === 'number' && Number.isFinite(json['zoom']) ? json['zoom'] : undefined;

    const boardAuraEnabled =
      typeof json['boardAuraEnabled'] === 'boolean' ? json['boardAuraEnabled'] : true;

    const chatSidebarOpen =
      typeof json['chatSidebarOpen'] === 'boolean' ? json['chatSidebarOpen'] : true;

    return {
      version: 1,
      graph,
      selectedNodeId,
      nodeChats: normalizeNodeChats(json['nodeChats'], json['chatMessages']),
      sidebarWidth,
      pan,
      zoom,
      boardAuraEnabled,
      chatSidebarOpen,
    };
  } catch {
    return null;
  }
}

export function loadWorkspace(storage: StorageLike | null | undefined): WorkspaceSnapshot | null {
  if (!storage) return null;
  try {
    return parseWorkspace(storage.getItem(WORKSPACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveWorkspace(
  storage: StorageLike | null | undefined,
  patch: Partial<Omit<WorkspaceSnapshot, 'version'>>,
): void {
  if (!storage) return;
  const prev = loadWorkspace(storage);
  const next: WorkspaceSnapshot = {
    version: 1,
    graph: patch.graph ?? prev?.graph ?? fallbackGraph(),
    selectedNodeId:
      patch.selectedNodeId !== undefined ? patch.selectedNodeId : (prev?.selectedNodeId ?? GOD_NODE_ID),
    nodeChats: patch.nodeChats ?? prev?.nodeChats ?? {},
    sidebarWidth: patch.sidebarWidth ?? prev?.sidebarWidth,
    pan: patch.pan ?? prev?.pan,
    zoom: patch.zoom ?? prev?.zoom,
    boardAuraEnabled:
      patch.boardAuraEnabled !== undefined
        ? patch.boardAuraEnabled
        : (prev?.boardAuraEnabled ?? true),
    chatSidebarOpen:
      patch.chatSidebarOpen !== undefined
        ? patch.chatSidebarOpen
        : (prev?.chatSidebarOpen ?? true),
  };

  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode — ignore
  }
}
