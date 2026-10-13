import type { ViewSpec } from './node-view.model';
import { parseViewSpec } from '../utils/node-view';
import {
  extractLayercoopRefresh,
  parseAutoRefresh,
  type AutoRefreshSpec,
} from '../utils/auto-refresh';

export type ArtifactKind = 'skill' | 'mcp' | 'agent' | 'rule' | 'pawn' | 'repo';

/** Единица исполнения LLM: local (bridge) или client (HTTP). */
export type RunnerId =
  | 'openai'
  | 'anthropic'
  | 'openai-compatible'
  | 'cursor'
  | 'claude-code'
  | 'opencode';

/** @deprecated используй RunnerId */
export type LlmProvider = RunnerId;

/** Конфиг вспомогательной LLM на pawn-ноде. */
export interface PawnLlmConfig {
  runner: RunnerId;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
}

export interface ArtifactNodeSize {
  w: number;
  h: number;
}

export interface ArtifactNodeData {
  kind: ArtifactKind;
  label: string;
  prompt: string;
  artifactPath?: string;
  artifactContent?: string;
  connected: boolean;
  /**
   * Skill как пайп: доступен в ПКМ → «Пайпы» и запускается через GOD
   * с force-include, даже без связи с графом.
   */
  pipe?: boolean;
  /** Только для kind === 'pawn' */
  llm?: PawnLlmConfig;
  /** Декларативная плитка (list/kv/markdown) на ноде */
  view?: ViewSpec;
  /** Расписание из промпта. Тики идут в MCP-код, не в LLM. */
  autoRefresh?: AutoRefreshSpec;
  /** Кастомный размер плитки на canvas */
  size?: ArtifactNodeSize;
  /** Абсолютный путь к локальному git-репозиторию (kind === 'repo') */
  repoPath?: string;
  /**
   * Куда писать `.layercoop/...` для этой ноды.
   * undefined = каталог Layercoop (cwd bridge); иначе abs path связанного repo.
   */
  saveRoot?: string;
}

export interface GodNodeData {
  label: string;
  runner: RunnerId;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Имя переменной из .env / Secrets — bridge подставит значение при запросе. */
  apiKeyEnv?: string;
  temperature: number;
  /**
   * claude-code: запускать с `--bare`. Даёт изоляцию от ambient-контекста
   * (CLAUDE.md, хуки, .mcp.json, плагины), но отключает подписочный login —
   * такому рану нужен Anthropic API key.
   */
  isolated: boolean;
}

export interface GraphNode {
  id: string;
  type: 'god' | 'artifact';
  position: { x: number; y: number };
  data: ArtifactNodeData | GodNodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

/** Визуальная группа нод на доске (рамка + сетка). Рёбра графа не меняет. */
export interface NodeGroup {
  id: string;
  memberIds: string[];
  /** Top-left рамки в world coords */
  position: { x: number; y: number };
}

export interface LayercoopGraph {
  version: 1;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Опциональные рамки-группы (Ctrl+клик). */
  groups?: NodeGroup[];
  updatedAt: string;
}

export interface ChatRunStep {
  id: string;
  kind: 'thought' | 'tool';
  label: string;
  text: string;
  status: 'running' | 'done';
}

/** Токены рана (из Cursor SDK / совместимых провайдеров). */
export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/** Статистика завершённого рана под ответом ассистента. */
export interface ChatRunStats {
  durationMs: number;
  usage?: ChatTokenUsage;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** Промежуточные шаги рана (мысль / tool) для гармошки в чате. */
  steps?: ChatRunStep[];
  /** Время / токены после завершения промпта. */
  stats?: ChatRunStats;
}

export interface ExportFile {
  path: string;
  content: string;
}

export const GOD_NODE_ID = 'cursor-god';

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  skill: 'Skill',
  mcp: 'MCP Server',
  agent: 'Agent',
  rule: 'Rule',
  pawn: 'Pawn',
  repo: 'Репозиторий',
};

export const ARTIFACT_KIND_ICONS: Record<ArtifactKind, string> = {
  skill: '📘',
  mcp: '🔌',
  agent: '🤖',
  rule: '📏',
  pawn: '♟️',
  repo: '📁',
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact';
}

export const RUNNER_LABELS: Record<RunnerId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI-compatible',
  cursor: 'Cursor (local)',
  'claude-code': 'Claude Code (local)',
  opencode: 'opencode (local)',
};

/** @deprecated используй RUNNER_LABELS */
export const LLM_PROVIDER_LABELS = RUNNER_LABELS;

/** Pawn — вспомогательная LLM по HTTP из браузера, local-раннеры ей не подходят. */
export const PAWN_RUNNERS: RunnerId[] = ['openai', 'openai-compatible', 'anthropic'];

/** @deprecated используй PAWN_RUNNERS */
export const PAWN_PROVIDERS = PAWN_RUNNERS;

const RUNNER_IDS = Object.keys(RUNNER_LABELS) as RunnerId[];

export function coerceRunnerId(value: unknown): RunnerId {
  if (typeof value === 'string' && (RUNNER_IDS as string[]).includes(value)) {
    return value as RunnerId;
  }
  return 'cursor';
}

/** @deprecated используй coerceRunnerId */
export const coerceLlmProvider = coerceRunnerId;

/** Имя GOD-ноды по умолчанию для runner: «opencode», «Claude Code», … */
export function defaultGodLabel(runner: RunnerId): string {
  return RUNNER_LABELS[runner].replace(/\s*\(local\)$/, '');
}

export function defaultGodData(): GodNodeData {
  return {
    label: defaultGodLabel('cursor'),
    runner: 'cursor',
    model: 'auto',
    baseUrl: '',
    apiKey: '',
    temperature: 0.2,
    isolated: false,
  };
}

/** Дефолт для corp / OpenAI-compatible вспомогательной LLM. */
export function defaultPawnLlm(): PawnLlmConfig {
  return {
    runner: 'openai-compatible',
    model: '',
    baseUrl: '',
    apiKey: '',
    temperature: 0.2,
  };
}

export function isGodData(data: GraphNode['data']): data is GodNodeData {
  return !('kind' in data);
}

/** Читает `runner` или legacy `provider`. */
export function readRunnerField(raw: Record<string, unknown>): unknown {
  return raw['runner'] ?? raw['provider'];
}

export function normalizeGodData(data: GraphNode['data'] | Partial<GodNodeData> | Record<string, unknown>): GodNodeData {
  if (data && typeof data === 'object' && 'kind' in data) {
    return defaultGodData();
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  const runner = coerceRunnerId(readRunnerField(raw));
  const model = typeof raw['model'] === 'string' ? raw['model'] : undefined;
  const legacyProvider = raw['provider'];
  const migratedFromPreview =
    legacyProvider === 'preview' ||
    model === 'local-preview' ||
    (raw['runner'] === undefined && legacyProvider === undefined);

  const merged: GodNodeData = {
    ...defaultGodData(),
    label: typeof raw['label'] === 'string' ? raw['label'] : defaultGodData().label,
    model: typeof raw['model'] === 'string' ? raw['model'] : defaultGodData().model,
    baseUrl: typeof raw['baseUrl'] === 'string' ? raw['baseUrl'] : defaultGodData().baseUrl,
    apiKey: typeof raw['apiKey'] === 'string' ? raw['apiKey'] : defaultGodData().apiKey,
    apiKeyEnv:
      typeof raw['apiKeyEnv'] === 'string' && raw['apiKeyEnv'].trim()
        ? raw['apiKeyEnv'].trim()
        : undefined,
    temperature:
      typeof raw['temperature'] === 'number' && Number.isFinite(raw['temperature'])
        ? raw['temperature']
        : defaultGodData().temperature,
    runner,
    isolated: raw['isolated'] === true,
  };
  // Старые графы: имя осталось дефолтным «Cursor», хотя runner уже другой.
  if (merged.label === defaultGodLabel('cursor') && runner !== 'cursor') {
    merged.label = defaultGodLabel(runner);
  }
  if (migratedFromPreview && runner === 'cursor') {
    merged.model = 'auto';
    if (!raw['baseUrl']) merged.baseUrl = '';
  }
  return merged;
}

export function isArtifactData(data: GraphNode['data']): data is ArtifactNodeData {
  return 'kind' in data;
}

const ARTIFACT_KINDS = Object.keys(ARTIFACT_KIND_LABELS) as ArtifactKind[];

export function coerceArtifactKind(value: unknown): ArtifactKind {
  if (typeof value === 'string' && (ARTIFACT_KINDS as string[]).includes(value)) {
    return value as ArtifactKind;
  }
  return 'skill';
}

export function normalizePawnLlm(raw: unknown): PawnLlmConfig {
  const base = defaultPawnLlm();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const temperature = Number(o['temperature']);
  return {
    runner: coerceRunnerId(readRunnerField(o) ?? base.runner),
    model: typeof o['model'] === 'string' ? o['model'] : base.model,
    baseUrl: typeof o['baseUrl'] === 'string' ? o['baseUrl'] : base.baseUrl,
    apiKey: typeof o['apiKey'] === 'string' ? o['apiKey'] : base.apiKey,
    temperature: Number.isFinite(temperature) ? temperature : base.temperature,
  };
}

export function normalizeArtifactData(raw: unknown): ArtifactNodeData {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const kind = coerceArtifactKind(o['kind']);
  const data: ArtifactNodeData = {
    kind,
    label: typeof o['label'] === 'string' ? o['label'] : `New ${kind}`,
    prompt: typeof o['prompt'] === 'string' ? o['prompt'] : '',
    connected: o['connected'] === true,
  };
  if (kind === 'skill' && o['pipe'] === true) data.pipe = true;
  if (typeof o['artifactPath'] === 'string') data.artifactPath = o['artifactPath'];
  if (typeof o['artifactContent'] === 'string') data.artifactContent = o['artifactContent'];
  if (typeof o['repoPath'] === 'string' && o['repoPath'].trim()) {
    data.repoPath = o['repoPath'].trim();
  }
  if (typeof o['saveRoot'] === 'string' && o['saveRoot'].trim()) {
    data.saveRoot = o['saveRoot'].trim();
  }
  const view = parseViewSpec(o['view']);
  if (view) data.view = view;
  const fromPrompt = parseAutoRefresh(data.prompt);
  const fromProgram = extractLayercoopRefresh(data.artifactContent);
  const storedRaw = o['autoRefresh'];
  const storedInterval =
    storedRaw &&
    typeof storedRaw === 'object' &&
    !Array.isArray(storedRaw) &&
    typeof (storedRaw as { intervalMs?: unknown }).intervalMs === 'number'
      ? Number((storedRaw as { intervalMs: number }).intervalMs)
      : NaN;
  if (fromPrompt) data.autoRefresh = fromPrompt;
  else if (fromProgram) data.autoRefresh = { intervalMs: fromProgram.intervalMs };
  else if (Number.isFinite(storedInterval) && storedInterval > 0) {
    data.autoRefresh = { intervalMs: storedInterval };
  }
  const size = normalizeArtifactSize(o['size']);
  if (size) data.size = size;
  if (kind === 'pawn') {
    data.llm = normalizePawnLlm(o['llm']);
  }
  return data;
}

export function normalizeArtifactSize(raw: unknown): ArtifactNodeSize | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const w = typeof o['w'] === 'number' ? o['w'] : Number.NaN;
  const h = typeof o['h'] === 'number' ? o['h'] : Number.NaN;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  // clamp живёт в edge-path — здесь только валидация формы; GraphService/resolve clamp'ит
  return { w, h };
}

export function stripPawnSecrets(data: ArtifactNodeData): ArtifactNodeData {
  if (data.kind !== 'pawn' || !data.llm) return data;
  return { ...data, llm: { ...data.llm, apiKey: '' } };
}
