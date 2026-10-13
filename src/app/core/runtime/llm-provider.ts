import type { GodNodeData, RunnerId } from '../models/graph.model';
import { RUNNER_LABELS, defaultGodLabel } from '../models/graph.model';
import {
  DEFAULT_OPENCODE_BASE_URL,
  type LocalRunnerId,
} from './local-runners';
import type { ChatContext } from '../utils/compose-context';
import {
  buildMcpServersFromArtifacts,
  type McpServerInline,
} from './mcp-servers';

export type { McpServerInline as CursorMcpServerInline } from './mcp-servers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const RUNNER_PRESETS: Record<RunnerId, Pick<GodNodeData, 'model' | 'baseUrl'>> = {
  openai: { model: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com' },
  'openai-compatible': { model: '', baseUrl: '' },
  cursor: { model: 'auto', baseUrl: '' },
  'claude-code': { model: 'claude-opus-5', baseUrl: '' },
  opencode: { model: '', baseUrl: DEFAULT_OPENCODE_BASE_URL },
};

export const CURSOR_MODEL_AUTO = 'auto';
/** Пустая модель GOD → Auto; живой каталог приходит из Cursor.models.list(). */
export const DEFAULT_CURSOR_MODEL = CURSOR_MODEL_AUTO;

export interface CursorParamChoice {
  value: string;
  label: string;
}

export interface CursorModelParamDef {
  id: string;
  label: string;
  values: CursorParamChoice[];
}

export interface CursorModelOption {
  id: string;
  label: string;
  parameters?: CursorModelParamDef[];
  defaultParams?: CursorModelParam[];
}

export interface CursorModelParam {
  id: string;
  value: string;
}

export function encodeCursorModelSelection(id: string, params?: CursorModelParam[]): string {
  const trimmed = id.trim();
  if (!trimmed) return DEFAULT_CURSOR_MODEL;
  if (!params?.length) return trimmed;
  const query = params
    .filter((p) => p.id.trim())
    .map((p) => `${encodeURIComponent(p.id.trim())}=${encodeURIComponent(p.value)}`)
    .join('&');
  return query ? `${trimmed}?${query}` : trimmed;
}

export function parseCursorModelSelection(raw: string | undefined | null): {
  id: string;
  params?: CursorModelParam[];
} {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return { id: DEFAULT_CURSOR_MODEL };
  const q = trimmed.indexOf('?');
  if (q < 0) return { id: trimmed };
  const id = trimmed.slice(0, q).trim() || DEFAULT_CURSOR_MODEL;
  const params: CursorModelParam[] = [];
  for (const pair of trimmed.slice(q + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const pid = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).trim());
    const value = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1));
    if (pid) params.push({ id: pid, value });
  }
  return params.length ? { id, params } : { id };
}

/** Короткое имя для карточки: без ?effort=…&fast=… */
export function displayModelName(raw: string | undefined | null): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  return parseCursorModelSelection(trimmed).id;
}

export function resolveCursorModelId(raw: string | undefined | null): string {
  const trimmed = raw?.trim() ?? '';
  return trimmed || DEFAULT_CURSOR_MODEL;
}

function readCursorParam(raw: unknown): CursorModelParam | null {
  if (!isRecord(raw) || typeof raw['id'] !== 'string') return null;
  const id = raw['id'].trim();
  if (!id) return null;
  return { id, value: typeof raw['value'] === 'string' ? raw['value'] : String(raw['value'] ?? '') };
}

function cursorItemLabel(item: Record<string, unknown>, fallback: string): string {
  if (typeof item['label'] === 'string' && item['label'].trim()) return item['label'].trim();
  if (typeof item['displayName'] === 'string' && item['displayName'].trim()) {
    return item['displayName'].trim();
  }
  return fallback;
}

function cursorEffortTokens(raw: unknown): string[] {
  const tokens: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) tokens.push(value.trim().toLowerCase());
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item)) push(item['value']);
      else push(item);
    }
    return tokens;
  }
  push(raw);
  return tokens;
}

const CURSOR_CURRENT_PARAM_IDS = new Set(['effort', 'optimize_for']);
const CURSOR_CURRENT_PARAM_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CURSOR_CURRENT_LABEL = /\b(high|medium|low|fast|extra high)\b/i;
const CURSOR_EFFORT_CHOICES: CursorParamChoice[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];
const CURSOR_FAST_FALLBACK: CursorModelParamDef = {
  id: 'fast',
  label: 'Fast',
  values: [
    { value: 'false', label: 'Off' },
    { value: 'true', label: 'Fast' },
  ],
};

function isCursorPickerModel(item: Record<string, unknown>): boolean {
  const modelId = typeof item['id'] === 'string' ? item['id'].trim().toLowerCase() : '';
  if (modelId === CURSOR_MODEL_AUTO || modelId === 'auto-smart' || modelId === 'default') {
    return true;
  }

  const parameters = Array.isArray(item['parameters']) ? item['parameters'] : [];
  for (const parameter of parameters) {
    if (!isRecord(parameter)) continue;
    const paramId = typeof parameter['id'] === 'string' ? parameter['id'].trim() : '';
    if (CURSOR_CURRENT_PARAM_IDS.has(paramId)) return true;
    if (cursorEffortTokens(parameter['values']).some((token) => CURSOR_CURRENT_PARAM_VALUES.has(token))) {
      return true;
    }
  }

  const variants = Array.isArray(item['variants']) ? item['variants'] : [];
  for (const variant of variants) {
    if (!isRecord(variant)) continue;
    if (CURSOR_CURRENT_LABEL.test(cursorItemLabel(variant, ''))) return true;
    const params = Array.isArray(variant['params']) ? variant['params'] : [];
    for (const param of params) {
      if (!isRecord(param)) continue;
      if (CURSOR_CURRENT_PARAM_VALUES.has(String(param['value'] ?? '').trim().toLowerCase())) return true;
    }
  }

  return false;
}

function pickCursorVariant(variants: Record<string, unknown>[]): Record<string, unknown> | null {
  if (variants.length === 0) return null;
  const defaults = variants.filter((variant) => variant['isDefault'] === true);
  const pool = defaults.length > 0 ? defaults : variants;
  return pool.reduce((best, current) => {
    const bestLen = Array.isArray(best['params']) ? best['params'].length : 0;
    const currentLen = Array.isArray(current['params']) ? current['params'].length : 0;
    return currentLen < bestLen ? current : best;
  });
}

function parseCursorParamDef(raw: unknown): CursorModelParamDef | null {
  if (!isRecord(raw) || typeof raw['id'] !== 'string' || !raw['id'].trim()) return null;
  const valuesRaw = Array.isArray(raw['values']) ? raw['values'] : [];
  const values: CursorParamChoice[] = [];
  for (const value of valuesRaw) {
    if (!isRecord(value) || typeof value['value'] !== 'string' || !value['value'].trim()) continue;
    const token = value['value'].trim();
    values.push({
      value: token,
      label:
        typeof value['displayName'] === 'string' && value['displayName'].trim()
          ? value['displayName'].trim()
          : token,
    });
  }
  if (values.length === 0) return null;
  return {
    id: raw['id'].trim(),
    label:
      typeof raw['displayName'] === 'string' && raw['displayName'].trim()
        ? raw['displayName'].trim()
        : raw['id'].trim(),
    values,
  };
}

function inferCursorParamDefs(variants: Record<string, unknown>[]): CursorModelParamDef[] {
  const byId = new Map<string, Set<string>>();
  for (const variant of variants) {
    const params = Array.isArray(variant['params']) ? variant['params'] : [];
    for (const param of params) {
      const parsed = readCursorParam(param);
      if (!parsed) continue;
      if (!byId.has(parsed.id)) byId.set(parsed.id, new Set());
      byId.get(parsed.id)!.add(parsed.value);
    }
  }
  return [...byId.entries()].map(([id, values]) => ({
    id,
    label: id,
    values: [...values].map((value) => ({ value, label: value })),
  }));
}

function cursorBaseLabel(label: string): string {
  const stripped = label.replace(/\s+(High Fast|Extra High|High|Medium|Low|Fast)$/i, '').trim();
  return stripped || label;
}

function parseStoredParams(raw: unknown): CursorModelParam[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readCursorParam).filter((p): p is CursorModelParam => p !== null);
}

export function cursorEffortParam(model?: CursorModelOption | null): CursorModelParamDef | null {
  if (!model) return null;
  const byId = new Map((model.parameters ?? []).map((parameter) => [parameter.id, parameter]));
  for (const id of ['effort', 'reasoning', 'thinking', 'optimize_for'] as const) {
    const parameter = byId.get(id);
    if (!parameter) continue;
    if (
      id === 'thinking' &&
      !parameter.values.some((choice) => CURSOR_CURRENT_PARAM_VALUES.has(choice.value.toLowerCase()))
    ) {
      continue;
    }
    return {
      ...parameter,
      label: id === 'optimize_for' ? 'Режим' : 'Effort',
    };
  }
  const fromDefault = (model.defaultParams ?? []).find((param) => {
    if (param.id === 'optimize_for') return true;
    return (
      (param.id === 'effort' || param.id === 'reasoning' || param.id === 'thinking') &&
      CURSOR_CURRENT_PARAM_VALUES.has(param.value.toLowerCase())
    );
  });
  if (fromDefault) {
    const values = [...CURSOR_EFFORT_CHOICES];
    if (!values.some((choice) => choice.value === fromDefault.value)) {
      values.push({ value: fromDefault.value, label: fromDefault.value });
    }
    return {
      id: fromDefault.id,
      label: fromDefault.id === 'optimize_for' ? 'Режим' : 'Effort',
      values,
    };
  }
  return { id: 'effort', label: 'Effort', values: CURSOR_EFFORT_CHOICES };
}

export function cursorFastParam(model?: CursorModelOption | null): CursorModelParamDef | null {
  return model?.parameters?.find((parameter) => parameter.id === 'fast') ?? CURSOR_FAST_FALLBACK;
}

function cursorModelFamily(id: string, label: string): string | null {
  const hay = `${id} ${label}`.toLowerCase();
  if (id === CURSOR_MODEL_AUTO || id === 'auto-smart' || id === 'default') return 'auto';
  if (hay.includes('grok')) return 'grok';
  if (hay.includes('opus')) return 'claude-opus';
  if (hay.includes('fable')) return 'claude-fable';
  if (hay.includes('muse')) return 'muse';
  if (hay.includes('gemini')) return 'gemini';
  if (hay.includes('codex') || hay.includes('sonnet') || hay.includes('haiku') || hay.includes('composer')) {
    return null;
  }
  if (hay.includes('gpt')) return 'gpt';
  return null;
}

function cursorModelVersion(id: string, label: string): number[] {
  const matches = `${label} ${id}`.match(/\d+(?:\.\d+)*/g) ?? [];
  const best = [...matches].sort((a, b) => b.length - a.length)[0] ?? '0';
  return best.split('.').map((part) => Number(part) || 0);
}

function compareCursorVersions(left: number[], right: number[]): number {
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const delta = (right[i] ?? 0) - (left[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

const CURSOR_FEATURED_KEEP: Record<string, number> = {
  auto: 9,
  grok: 2,
  'claude-opus': 2,
  'claude-fable': 1,
  gpt: 1,
  gemini: 1,
  muse: 1,
};

export function keepCursorFeaturedModels(options: CursorModelOption[]): CursorModelOption[] {
  const groups = new Map<string, CursorModelOption[]>();
  for (const option of options) {
    const family = cursorModelFamily(option.id, option.label);
    if (!family) continue;
    const list = groups.get(family) ?? [];
    list.push(option);
    groups.set(family, list);
  }
  const kept = new Set<string>();
  for (const [family, items] of groups) {
    const limit = CURSOR_FEATURED_KEEP[family] ?? 1;
    const sorted = [...items].sort((a, b) => {
      if (family === 'gpt') {
        const aSol = /sol/i.test(a.label) ? 1 : 0;
        const bSol = /sol/i.test(b.label) ? 1 : 0;
        if (bSol !== aSol) return bSol - aSol;
      }
      return compareCursorVersions(
        cursorModelVersion(a.id, a.label),
        cursorModelVersion(b.id, b.label),
      );
    });
    for (const item of sorted.slice(0, limit)) kept.add(item.id);
  }
  return options.filter((option) => kept.has(option.id));
}

export function selectCursorModel(
  modelId: string,
  previous: string | undefined,
  catalog: CursorModelOption[],
): string {
  const model = catalog.find((item) => item.id === modelId);
  const prev = parseCursorModelSelection(previous);
  const merged = new Map((model?.defaultParams ?? []).map((param) => [param.id, param]));
  if (model?.parameters && prev.params) {
    const allowed = new Set(model.parameters.map((parameter) => parameter.id));
    for (const param of prev.params) {
      if (allowed.has(param.id)) merged.set(param.id, param);
    }
  }
  return encodeCursorModelSelection(modelId, [...merged.values()]);
}

export function setCursorModelParam(raw: string, paramId: string, value: string): string {
  const selection = parseCursorModelSelection(raw);
  const params = [...(selection.params ?? [])];
  const index = params.findIndex((param) => param.id === paramId);
  if (paramId === 'fast' && (value === 'false' || value === '')) {
    if (index >= 0) params.splice(index, 1);
    return encodeCursorModelSelection(selection.id, params);
  }
  if (index >= 0) params[index] = { id: paramId, value };
  else params.push({ id: paramId, value });
  return encodeCursorModelSelection(selection.id, params);
}

function paramDefFromStored(param: CursorModelParam): CursorModelParamDef {
  if (param.id === 'fast') return CURSOR_FAST_FALLBACK;
  if (param.id === 'effort' || param.id === 'reasoning' || param.id === 'thinking') {
    const values = [...CURSOR_EFFORT_CHOICES];
    if (!values.some((choice) => choice.value === param.value)) {
      values.push({ value: param.value, label: param.value });
    }
    return { id: param.id, label: 'Effort', values };
  }
  return { id: param.id, label: param.id, values: [{ value: param.value, label: param.value }] };
}

function mergeParamDefs(
  base: CursorModelParamDef[],
  extra: CursorModelParamDef[],
): CursorModelParamDef[] {
  const byId = new Map(base.map((parameter) => [parameter.id, parameter]));
  for (const parameter of extra) {
    const prev = byId.get(parameter.id);
    if (!prev) {
      byId.set(parameter.id, parameter);
      continue;
    }
    const values = [...prev.values];
    for (const choice of parameter.values) {
      if (!values.some((item) => item.value === choice.value)) values.push(choice);
    }
    byId.set(parameter.id, { ...prev, values });
  }
  return [...byId.values()];
}

function enrichCursorOption(option: CursorModelOption): CursorModelOption {
  const existing = option.parameters ?? [];
  const known = new Set(existing.map((parameter) => parameter.id));
  const inferred = (option.defaultParams ?? [])
    .filter((param) => !known.has(param.id))
    .map(paramDefFromStored);
  const parameters = mergeParamDefs(existing, inferred);
  return { ...option, ...(parameters.length ? { parameters } : {}) };
}

function mergeCursorOption(existing: CursorModelOption, incoming: CursorModelOption): CursorModelOption {
  const parameters = mergeParamDefs(existing.parameters ?? [], incoming.parameters ?? []);
  const existingDefault = existing.defaultParams ?? [];
  const incomingDefault = incoming.defaultParams ?? [];
  const defaultParams =
    incomingDefault.length && (!existingDefault.length || incomingDefault.length < existingDefault.length)
      ? incomingDefault
      : existingDefault;
  return {
    ...existing,
    label: existing.label || incoming.label,
    ...(parameters.length ? { parameters } : {}),
    ...(defaultParams.length ? { defaultParams } : {}),
  };
}

export function parseCursorModelsList(raw: unknown): CursorModelOption[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['items'])
      ? raw['items']
      : isRecord(raw) && Array.isArray(raw['models'])
        ? raw['models']
        : [];
  const out: CursorModelOption[] = [];
  const push = (option: CursorModelOption) => {
    const next = enrichCursorOption(option);
    if (!next.id) return;
    const index = out.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      out[index] = mergeCursorOption(out[index]!, next);
      return;
    }
    out.push(next);
  };

  for (const item of items) {
    if (!isRecord(item)) continue;
    const rawId = typeof item['id'] === 'string' ? item['id'].trim() : '';
    if (!rawId) continue;
    const preParsedLabel = typeof item['label'] === 'string' ? item['label'].trim() : '';
    const preParsed = preParsedLabel !== '' && !Array.isArray(item['variants']);
    if (preParsed) {
      const selection = parseCursorModelSelection(rawId);
      const parameters = Array.isArray(item['parameters'])
        ? item['parameters'].map(parseCursorParamDef).filter((p): p is CursorModelParamDef => p !== null)
        : [];
      const storedDefaults = parseStoredParams(item['defaultParams']);
      push({
        id: selection.id,
        label: cursorBaseLabel(preParsedLabel),
        ...(parameters.length ? { parameters } : {}),
        ...(storedDefaults.length || selection.params
          ? { defaultParams: storedDefaults.length ? storedDefaults : selection.params }
          : {}),
      });
      continue;
    }
    if (!isCursorPickerModel(item)) continue;
    const modelId = rawId.includes('?') ? parseCursorModelSelection(rawId).id : rawId;
    const displayName = cursorItemLabel(item, modelId);
    const variants = Array.isArray(item['variants'])
      ? item['variants'].filter(isRecord)
      : [];
    const parametersFromSdk = Array.isArray(item['parameters'])
      ? item['parameters'].map(parseCursorParamDef).filter((p): p is CursorModelParamDef => p !== null)
      : [];
    const parameters =
      parametersFromSdk.length > 0 ? parametersFromSdk : inferCursorParamDefs(variants);
    const picked = pickCursorVariant(variants);
    const defaultParams = picked
      ? (Array.isArray(picked['params'])
          ? picked['params'].map(readCursorParam).filter((p): p is CursorModelParam => p !== null)
          : [])
      : [];
    push({
      id: modelId,
      label: displayName,
      ...(parameters.length ? { parameters } : {}),
      ...(defaultParams.length ? { defaultParams } : {}),
    });
  }

  return keepCursorFeaturedModels(out);
}

export function cursorModelOptions(
  current?: string,
  catalog: CursorModelOption[] = [],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const item of catalog) push(item.id);
  const trimmed = current?.trim();
  if (trimmed && !seen.has(trimmed)) return [trimmed, ...ids];
  return ids;
}

export function withCurrentCursorModel(
  catalog: CursorModelOption[],
  current?: string,
): CursorModelOption[] {
  const currentId = parseCursorModelSelection(current).id;
  if (!current?.trim() || catalog.some((model) => model.id === currentId)) return catalog;
  return [{ id: currentId, label: cursorModelLabel(currentId) }, ...catalog];
}

export function cursorModelLabel(id: string): string {
  return id === CURSOR_MODEL_AUTO ? 'Auto' : id;
}

/** @deprecated используй RUNNER_PRESETS */
export const LLM_PROVIDER_PRESETS = RUNNER_PRESETS;

/** RunnerId → local bridge runner. */
export const RUNNER_TO_LOCAL: Partial<Record<RunnerId, LocalRunnerId>> = {
  cursor: 'cursor',
  'claude-code': 'claude-code',
  opencode: 'opencode',
};

/** @deprecated используй RUNNER_TO_LOCAL */
export const PROVIDER_RUNTIME = RUNNER_TO_LOCAL;

export function localRunnerFor(runner: RunnerId): LocalRunnerId | undefined {
  return RUNNER_TO_LOCAL[runner];
}

/** @deprecated используй localRunnerFor */
export const bridgeRuntimeFor = localRunnerFor;

export function isLocalRunner(runner: RunnerId): boolean {
  return localRunnerFor(runner) !== undefined;
}

/** @deprecated используй isLocalRunner */
export const usesBridge = isLocalRunner;

export function isClientRunner(runner: RunnerId): boolean {
  return runner === 'openai' || runner === 'openai-compatible';
}

export function applyRunnerPreset(current: GodNodeData, runner: RunnerId): GodNodeData {
  const preset = RUNNER_PRESETS[runner];
  // Имя, которое пользователь не трогал, следует за runner.
  const labelIsDefault = !current.label.trim() || current.label === defaultGodLabel(current.runner);
  return {
    ...current,
    runner,
    label: labelIsDefault ? defaultGodLabel(runner) : current.label,
    model: preset.model,
    baseUrl: preset.baseUrl,
  };
}

/** @deprecated используй applyRunnerPreset */
export const applyProviderPreset = applyRunnerPreset;

export function stripGodSecrets(data: GodNodeData): GodNodeData {
  return { ...data, apiKey: '' };
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** GET {base}/models для OpenAI-compatible API. */
export function modelsListUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/models')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.replace(/\/chat\/completions$/, '/models');
  }
  return `${trimmed}/models`;
}

export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey = '',
  options: { fetchImpl?: typeof fetch; apiKeyEnv?: string; bridgeBase?: string } = {},
): Promise<string[]> {
  const trimmedBase = baseUrl.trim();
  if (!trimmedBase) return [];

  const fetchImpl = options.fetchImpl ?? fetch;
  const bridge = (options.bridgeBase ?? '/layercoop-bridge').replace(/\/+$/, '');
  const res = await fetchImpl(`${bridge}/v1/openai/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: trimmedBase,
      apiKey: apiKey.trim(),
      ...(options.apiKeyEnv?.trim() ? { apiKeyEnv: options.apiKeyEnv.trim() } : {}),
    }),
  });
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (isRecord(payload) &&
        isRecord(payload['error']) &&
        typeof payload['error']['message'] === 'string' &&
        payload['error']['message']) ||
      `Models HTTP ${res.status}`;
    throw new Error(message);
  }

  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    throw new Error('Неверный ответ /models');
  }

  const ids = payload['data']
    .map((item) => (isRecord(item) && typeof item['id'] === 'string' ? item['id'].trim() : ''))
    .filter(Boolean);

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function cursorModelsUrl(base = '/layercoop-bridge'): string {
  return `${base.replace(/\/+$/, '')}/v1/cursor/models`;
}

export async function fetchCursorModels(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; bridgeBase?: string } = {},
): Promise<CursorModelOption[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(cursorModelsUrl(options.bridgeBase), { method: 'GET', headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = body.trim() || `Models HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (isRecord(parsed) && typeof parsed['error'] === 'string' && parsed['error'].trim()) {
        message = parsed['error'].trim();
      }
    } catch {
      /* raw body */
    }
    throw new Error(message);
  }

  const payload = (await res.json()) as unknown;
  return parseCursorModelsList(payload);
}

export function usesOpenAiCompatibleApi(runner: RunnerId): boolean {
  return isClientRunner(runner);
}

export function usesCursorApi(runner: RunnerId): boolean {
  return runner === 'cursor';
}

/** Ключ обязателен только для Cursor: Claude Code берёт подписку, opencode — свой конфиг. */
export function requiresApiKey(runner: RunnerId): boolean {
  return runner === 'cursor';
}

const MISSING_KEY_HINT: Partial<Record<RunnerId, string>> = {
  cursor: 'Укажите Cursor API key (Dashboard → API Keys)',
};

export const BRIDGE_OFFLINE_HINT =
  'Local bridge недоступен. Запусти `npm run bridge` (или `npm run dev`).';

/** Base URL for local Cursor SDK sidecar (default via Angular proxy). */
export function bridgeBase(god: GodNodeData): string {
  // Для opencode baseUrl — адрес его headless-сервера, а не bridge.
  if (god.runner === 'opencode') return '/layercoop-bridge';
  const trimmed = god.baseUrl.trim().replace(/\/+$/, '');
  if (
    !trimmed ||
    trimmed === '/cursor-api' ||
    trimmed.includes('api.cursor.com')
  ) {
    return '/layercoop-bridge';
  }
  return trimmed;
}

/** MCP только с подключённых artifact-нод графа (не из Cursor IDE). */
export function buildCursorMcpServers(context: ChatContext): McpServerInline[] {
  return buildMcpServersFromArtifacts(context.connectedArtifacts);
}

export type BridgeTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type BridgeSseEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool';
      name: string;
      status: 'start' | 'end';
      callId?: string;
      detail?: string;
    }
  | {
      type: 'done';
      result: string;
      durationMs?: number;
      usage?: BridgeTokenUsage;
    }
  | { type: 'error'; message: string };

export function buildBridgeRunBody(god: GodNodeData, context: ChatContext) {
  const runner = localRunnerFor(god.runner) ?? 'cursor';
  const fallbackModel = runner === 'cursor' ? DEFAULT_CURSOR_MODEL : '';
  return {
    runner,
    apiKey: god.apiKey,
    model: runner === 'cursor' ? resolveCursorModelId(god.model) : god.model.trim() || fallbackModel,
    prompt: context.userPrompt,
    systemContext: context.systemPrompt,
    mcpServers: buildCursorMcpServers(context),
    ...(context.workspaceCwd ? { cwd: context.workspaceCwd } : {}),
    ...(runner === 'claude-code' ? { isolated: god.isolated === true } : {}),
    ...(runner === 'opencode'
      ? { baseUrl: god.baseUrl.trim() || DEFAULT_OPENCODE_BASE_URL }
      : {}),
  };
}

/** @deprecated имя из времён единственного cursor-раннера. */
export const buildCursorBridgeRunBody = buildBridgeRunBody;

export function parseBridgeSseChunk(raw: string): BridgeSseEvent[] {
  const events: BridgeSseEvent[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const line = block
      .split('\n')
      .map((l) => l.trimEnd())
      .find((l) => l.startsWith('data:'));
    if (!line) continue;
    const json = line.replace(/^data:\s?/, '').trim();
    if (!json || json === '[DONE]') continue;
    try {
      events.push(JSON.parse(json) as BridgeSseEvent);
    } catch {
      /* skip malformed */
    }
  }
  return events;
}

async function* iterateBridgeSse(res: Response): AsyncGenerator<BridgeSseEvent> {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        for (const ev of parseBridgeSseChunk(part + '\n\n')) yield ev;
      }
    }
    if (buf.trim()) {
      for (const ev of parseBridgeSseChunk(buf + '\n\n')) yield ev;
    }
    return;
  }

  const text = await res.text();
  for (const ev of parseBridgeSseChunk(text)) yield ev;
}

export interface CursorLocalOptions {
  fetchImpl?: typeof fetch;
  onEvent?: (event: BridgeSseEvent) => void;
  signal?: AbortSignal;
}

export async function checkBridgeHealth(
  base = '/layercoop-bridge',
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/health`, {
      method: 'GET',
    });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json?.ok === true;
  } catch {
    return false;
  }
}

export async function* streamBridgeRun(
  god: GodNodeData,
  context: ChatContext,
  options: CursorLocalOptions = {},
): AsyncGenerator<BridgeSseEvent> {
  if (requiresApiKey(god.runner) && !god.apiKey.trim()) {
    throw new Error(MISSING_KEY_HINT[god.runner] ?? 'Укажите API key на GOD-ноде');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const base = bridgeBase(god);

  let res: Response;
  try {
    res = await fetchImpl(`${base}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBridgeRunBody(god, context)),
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new Error(BRIDGE_OFFLINE_HINT);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 0 || res.status >= 500) {
      throw new Error(body.trim() || BRIDGE_OFFLINE_HINT);
    }
    throw new Error(body.trim() || `Bridge HTTP ${res.status}`);
  }

  for await (const event of iterateBridgeSse(res)) {
    options.onEvent?.(event);
    yield event;
    if (event.type === 'error') {
      throw new Error(event.message);
    }
    if (event.type === 'done') return;
  }

  throw new Error('Bridge закрыл поток без done');
}

/** @deprecated имя из времён единственного cursor-раннера. */
export const streamCursorLocal = streamBridgeRun;

/** Local-раннер (cursor / claude-code / opencode) через layercoop-bridge (SSE). */
export async function completeBridgeRun(
  god: GodNodeData,
  context: ChatContext,
  options: CursorLocalOptions = {},
): Promise<string> {
  let result = '';
  let tokens = '';
  for await (const event of streamBridgeRun(god, context, options)) {
    if (event.type === 'token') tokens += event.text;
    if (event.type === 'done') result = event.result || tokens;
  }
  if (!result && tokens) return tokens;
  if (!result) {
    throw new Error(`Пустой ответ local-раннера (${RUNNER_LABELS[god.runner]})`);
  }
  return result;
}

/** @deprecated имя из времён единственного cursor-раннера. */
export const completeCursorLocal = completeBridgeRun;

export function buildChatCompletionsRequest(god: GodNodeData, context: ChatContext) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = god.apiKey.trim();
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  return {
    url: chatCompletionsUrl(god.baseUrl),
    headers,
    body: {
      model: god.model,
      temperature: god.temperature,
      messages: [
        { role: 'system', content: context.systemPrompt },
        { role: 'user', content: context.userPrompt },
      ],
    },
  };
}

export function parseChatCompletionsContent(payload: unknown): string {
  const json = payload as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.length > 0) return content;
  if (json.error?.message) throw new Error(json.error.message);
  throw new Error('Пустой ответ LLM');
}

export async function completeOpenAiCompatible(
  god: GodNodeData,
  context: ChatContext,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (!god.baseUrl.trim()) throw new Error('Укажите Base URL у GOD-ноды');
  if (!god.model.trim()) throw new Error('Укажите модель у GOD-ноды');
  const apiKey = god.apiKey.trim();
  const apiKeyEnv = god.apiKeyEnv?.trim() ?? '';
  if (!apiKey && !apiKeyEnv) {
    throw new Error(
      'Укажите API key на ноде или apiKeyEnv (например OPEN_WEBUI_TOKEN в Secrets)',
    );
  }

  // Через bridge: нет CORS к corp OpenWebUI + подстановка ключа из .env по apiKeyEnv
  // + MCP tool-loop (stdio из графа / .layercoop/mcp.json).
  const bridgeUrl = `${bridgeBase({ ...god, runner: 'cursor', baseUrl: '' })}/v1/openai/chat/completions`;
  const mcpServers = buildCursorMcpServers(context);
  const res = await fetchImpl(bridgeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: god.baseUrl.trim(),
      model: god.model.trim(),
      temperature: god.temperature,
      messages: [
        { role: 'system', content: context.systemPrompt },
        { role: 'user', content: context.userPrompt },
      ],
      apiKey,
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      mcpServers,
      useDiskMcp: true,
      ...(context.workspaceCwd ? { cwd: context.workspaceCwd } : {}),
    }),
    signal,
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parseChatCompletionsContent(json);
}
