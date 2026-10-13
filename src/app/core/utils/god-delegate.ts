import { coerceRunnerId, type RunnerId } from '../models/graph.model';

export interface DelegateSpec {
  targetId: string;
  task: string;
}

export interface GodSpawnSpec {
  label: string;
  runner: RunnerId;
  model: string;
  baseUrl: string;
  apiKey?: string;
  /** Имя переменной из Secrets / .env — UI подставит значение в apiKey. */
  apiKeyEnv?: string;
  linkToPrimary: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DELEGATE_FENCE_RE = /```layercoop-delegate\s*\n([\s\S]*?)```/i;
const GOD_FENCE_RE = /```layercoop-god\s*\n([\s\S]*?)```/i;

export function parseDelegateSpec(raw: unknown): DelegateSpec | null {
  if (!isRecord(raw)) return null;
  const targetId = typeof raw['targetId'] === 'string' ? raw['targetId'].trim() : '';
  const task = typeof raw['task'] === 'string' ? raw['task'].trim() : '';
  if (!targetId || !task) return null;
  return { targetId, task };
}

export function extractLayercoopDelegate(reply: string): DelegateSpec | null {
  const match = reply.match(DELEGATE_FENCE_RE);
  if (!match?.[1]) return null;
  try {
    return parseDelegateSpec(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

export function stripLayercoopDelegateFence(reply: string): string {
  return reply.replace(DELEGATE_FENCE_RE, '').trim();
}

export function parseGodSpawnSpec(raw: unknown): GodSpawnSpec | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw['label'] === 'string' ? raw['label'].trim() : '';
  const model = typeof raw['model'] === 'string' ? raw['model'].trim() : '';
  const baseUrl = typeof raw['baseUrl'] === 'string' ? raw['baseUrl'].trim() : '';
  if (!label && !model && !baseUrl) return null;
  const runnerRaw = raw['runner'];
  const runner =
    typeof runnerRaw === 'string' && runnerRaw.trim()
      ? coerceRunnerId(runnerRaw)
      : ('openai-compatible' as RunnerId);
  return {
    label: label || model || baseUrl || 'New LLM',
    runner,
    model,
    baseUrl,
    apiKey: typeof raw['apiKey'] === 'string' ? raw['apiKey'] : undefined,
    apiKeyEnv:
      typeof raw['apiKeyEnv'] === 'string' && raw['apiKeyEnv'].trim()
        ? raw['apiKeyEnv'].trim()
        : undefined,
    linkToPrimary: raw['linkToPrimary'] !== false,
  };
}

export function extractLayercoopGod(reply: string): GodSpawnSpec | null {
  const match = reply.match(GOD_FENCE_RE);
  if (!match?.[1]) return null;
  try {
    return parseGodSpawnSpec(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

export function stripLayercoopGodFence(reply: string): string {
  return reply.replace(GOD_FENCE_RE, '').trim();
}

/** Промпт просит подключить ещё одну LLM / саб-GOD (не skill). */
export function wantsSubGodPrompt(prompt: string): boolean {
  const t = prompt.toLowerCase();
  if (/deepseek|саб[\s-]?год|sub[\s-]?god|openwebui|open[\s-]?web[\s-]?ui/.test(t)) return true;
  if (/(подключ|добав|созда).{0,24}(ещё\s+одн|еще\s+одн|друг).{0,12}llm/.test(t)) return true;
  if (/(подключ|добав|созда).{0,20}(llm|ллм)/.test(t) && /corp|корпорат|endpoint|base\s*url/.test(t)) {
    return true;
  }
  if (/openai-compatible/.test(t) && /(base\s*url|endpoint|llm|ллм|модел)/.test(t)) return true;
  return false;
}
