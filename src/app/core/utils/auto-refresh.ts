import { parseMcpServersFromArtifactContent } from '../runtime/mcp-servers';
import type { ViewSpec } from '../models/node-view.model';
import { parseViewSpec } from './node-view';

export interface AutoRefreshSpec {
  intervalMs: number;
}

export interface LayercoopRefreshProgram {
  intervalMs: number;
  server: string;
  source: string;
}

const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

function unitMs(unit: string): number | null {
  const u = unit.toLowerCase();
  if (/^сек|^sec|^second/.test(u)) return 1000;
  if (/^мин|^min/.test(u)) return 60_000;
  if (/^час|^hour|^hr/.test(u)) return 3_600_000;
  if (/^сут|^ден|^дня|^дней|^day/.test(u)) return 86_400_000;
  return null;
}

function clampInterval(ms: number): number | null {
  if (!Number.isFinite(ms)) return null;
  const rounded = Math.round(ms);
  if (rounded < MIN_INTERVAL_MS || rounded > MAX_INTERVAL_MS) return null;
  return rounded;
}

function intervalFromMatch(amount: string, unit: string): number | null {
  const n = Number(amount);
  const mult = unitMs(unit);
  if (!Number.isFinite(n) || n <= 0 || !mult) return null;
  return clampInterval(n * mult);
}

const UNIT =
  '(секунд[а-яё]*|сек|seconds?|sec|минут[а-яё]*|мин|minutes?|min|час(?:а|ов)?|hours?|hr|сут(?:ки|ок)?|день|дня|дней|days?)';

const SCHEDULE_RE = new RegExp(
  `(?:каждые|каждый|каждую|раз\\s+в|every)\\s+(\\d+)\\s*${UNIT}(?![a-zа-яё])`,
  'i',
);

/** «раз в сутки» / «every day» без числа */
const DAY_BARE_RE =
  /(?:раз\s+в\s+сутки|каждые?\s+сутки|every\s+day|daily)(?![a-zа-яё])/i;

const LOOSE_RE = new RegExp(`(\\d+)\\s*${UNIT}(?![a-zа-яё])`, 'i');

const AUTO_WORD_RE =
  /автообнов|auto[-\s]?refresh|auto[-\s]?update|always[-\s]?on|\bcron\b|крон|по\s*расписан|по\s*крону/i;

/** Интервал из промпта («раз в 5 минут», «every 30 seconds», «автообновление каждые 5 мин»). */
export function parseAutoRefresh(prompt: string): AutoRefreshSpec | null {
  const text = prompt.trim();
  if (!text) return null;
  const scheduled = text.match(SCHEDULE_RE);
  if (scheduled?.[1] && scheduled[2]) {
    const intervalMs = intervalFromMatch(scheduled[1], scheduled[2]);
    if (intervalMs) return { intervalMs };
  }
  if (DAY_BARE_RE.test(text)) {
    return { intervalMs: 86_400_000 };
  }
  if (!AUTO_WORD_RE.test(text)) return null;
  const loose = text.match(LOOSE_RE);
  if (loose?.[1] && loose[2]) {
    const intervalMs = intervalFromMatch(loose[1], loose[2]);
    if (intervalMs) return { intervalMs };
  }
  // always-on / cron без явного интервала → 5 мин по умолчанию
  if (/always[-\s]?on|\bcron\b|крон|по\s*крону/i.test(text)) {
    return { intervalMs: 300_000 };
  }
  return null;
}

export function formatRefreshInterval(intervalMs: number): string {
  if (intervalMs % 86_400_000 === 0) return `${intervalMs / 86_400_000} д`;
  if (intervalMs % 3_600_000 === 0) return `${intervalMs / 3_600_000} ч`;
  if (intervalMs % 60_000 === 0) return `${intervalMs / 60_000} мин`;
  return `${Math.round(intervalMs / 1000)} с`;
}

/** Каноническая фраза для prompt ноды (UI парсит через parseAutoRefresh). */
export function schedulePhrase(intervalMs: number): string {
  if (intervalMs >= 86_400_000 && intervalMs % 86_400_000 === 0) {
    const n = intervalMs / 86_400_000;
    return n === 1 ? 'крон раз в сутки' : `крон раз в ${n} дня`;
  }
  if (intervalMs % 3_600_000 === 0) {
    const n = intervalMs / 3_600_000;
    return n === 1 ? 'крон каждый час' : `крон каждые ${n} часа`;
  }
  if (intervalMs % 60_000 === 0) {
    const n = intervalMs / 60_000;
    return n === 1 ? 'крон каждую минуту' : `крон каждые ${n} мин`;
  }
  const sec = Math.max(1, Math.round(intervalMs / 1000));
  return `крон каждые ${sec} сек`;
}

/** Дописать расписание в prompt, не дублируя тот же intervalMs. */
export function mergeScheduleIntoPrompt(prompt: string, intervalMs: number): string {
  const base = prompt.trim();
  const current = parseAutoRefresh(base);
  if (current?.intervalMs === intervalMs) return base || schedulePhrase(intervalMs);
  const phrase = schedulePhrase(intervalMs);
  if (!base) return phrase;
  // убрать старую каноническую «крон …» если меняем интервал
  const cleaned = base
    .replace(/(?:^|[.!?]\s*)крон\s+(?:раз\s+в|кажд\w*)[^.!?\n]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const head = cleaned || base;
  const sep = /[.!?]$/.test(head) ? ' ' : '. ';
  return `${head}${sep}${phrase}`;
}

const CREATE_INTENT_RE =
  /созда[йеём]|сгенерир|подключ|нову(?:ю|й)?\s+нод|wizard|layercoop-wizard/i;

const EXTRA_EDIT_RE =
  /перепиш|передела|допиши\s+в\s+skill|измени\s+текст|добавь\s+раздел|rewrite|refactor/i;

/**
 * Запрос только проставить расписание на уже существующую ноду
 * (без создания новой и без прочих правок содержимого).
 */
export function isPureScheduleAddRequest(text: string): AutoRefreshSpec | null {
  const t = text.trim();
  if (!t) return null;
  const spec = parseAutoRefresh(t);
  if (!spec) return null;
  if (CREATE_INTENT_RE.test(t) || EXTRA_EDIT_RE.test(t)) return null;

  const rest = t
    .replace(SCHEDULE_RE, ' ')
    .replace(DAY_BARE_RE, ' ')
    .replace(AUTO_WORD_RE, ' ')
    .replace(LOOSE_RE, ' ')
    .replace(
      /добав\w*|поставь|постав\w*|включи|не\s*забудь|обновл\w*|скилл?|skill|нод[аеуы]?|файл\w*|пожалуйста|please|pls|что\s*б[ы]?|чтобы|раз|сутк\w*|день|дня|дней|day|daily|every|min(?:ute)?s?|час\w*|hour\w*|sec(?:ond)?s?|мин\w*|сек\w*/gi,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  if (rest.length === 0 || rest.length <= 16) return spec;
  return null;
}

/** Остаток до следующего тика; 0 = пора / уже просрочено. */
export function msUntilNextRefresh(
  lastRefreshAt: number,
  intervalMs: number,
  now = Date.now(),
): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  if (!lastRefreshAt) return 0;
  return Math.max(0, lastRefreshAt + intervalMs - now);
}

export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'сейчас';
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))}с`;
  const m = Math.floor(ms / 60_000);
  const s = Math.ceil((ms % 60_000) / 1000);
  return s && s < 60 ? `${m}м ${s}с` : `${m}м`;
}

/** MR !78 pipeline → 78 */
export function parseMrIidFromTitle(title: string): number | null {
  const m = /!\s*(\d+)/.exec(title);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Тело refresh-функции: только MCP tool, без LLM. */
export function buildLayercoopRefreshSource(
  title: string,
  tool = 'refresh',
  args: Record<string, unknown> = {},
): string {
  return [
    `const raw = await callTool(${JSON.stringify(tool)}, ${JSON.stringify(args)});`,
    'const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);',
    'const pickMeta = (row) => {',
    '  if (!row || typeof row !== "object") return undefined;',
    '  for (const key of ["meta", "status", "state"]) {',
    '    const v = row[key];',
    '    if (typeof v === "string" && v.trim()) return v.trim();',
    '  }',
    '  return undefined;',
    '};',
    'return {',
    '  type: "list",',
    `  title: ${JSON.stringify(title)},`,
    '  items: rows.slice(0, 50).map((row) => {',
    '    const text = String((row && (row.title || row.text || row.name)) || "").trim();',
    '    if (/^pipeline\\s*#\\d+/i.test(text)) return null;',
    '    const href = row && typeof row.web_url === "string" ? row.web_url : (row && typeof row.href === "string" ? row.href : undefined);',
    '    return { text, href, meta: pickMeta(row) };',
    '  }).filter((item) => item && item.text),',
    '};',
  ].join('\n');
}

export const PIPELINE_STATUS_REFRESH_MS = 15_000;

/** JSON artifactContent для плитки статусов pipeline (тикает ViewRefreshService). */
export function buildPipelineStatusRefreshContent(
  title: string,
  server: string,
  tool = 'list_pipeline_jobs',
): string {
  const mrIid = parseMrIidFromTitle(title);
  const args = mrIid ? { merge_request_iid: mrIid } : {};
  return JSON.stringify(
    {
      layercoopRefresh: {
        intervalMs: PIPELINE_STATUS_REFRESH_MS,
        server,
        source: buildLayercoopRefreshSource(title, tool, args),
      },
    },
    null,
    2,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractLayercoopRefresh(content: string | undefined | null): LayercoopRefreshProgram | null {
  if (!content?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed['layercoopRefresh'])) return null;
  const block = parsed['layercoopRefresh'];
  const intervalMs = clampInterval(Number(block['intervalMs']));
  const server = typeof block['server'] === 'string' ? block['server'].trim() : '';
  const source = typeof block['source'] === 'string' ? block['source'].trim() : '';
  if (!intervalMs || !server || !source) return null;
  return { intervalMs, server, source };
}

function contentHasMcpServers(content: string): boolean {
  return parseMcpServersFromArtifactContent(content).length > 0;
}

/**
 * Программа: своя (плитка) или у соседа.
 * mcpServers для bridge: из своего content, иначе у соседнего MCP
 * (spawn pipeline кладёт только layercoopRefresh без серверов).
 */
export function pickRefreshProgram(
  selfContent: string | undefined,
  neighborMcpContents: string[],
): { program: LayercoopRefreshProgram; artifactContent: string } | null {
  const own = extractLayercoopRefresh(selfContent);
  if (own && selfContent) {
    if (contentHasMcpServers(selfContent)) {
      return { program: own, artifactContent: selfContent };
    }
    const neighborWithServers = neighborMcpContents.find(contentHasMcpServers);
    if (neighborWithServers) {
      return { program: own, artifactContent: neighborWithServers };
    }
    return { program: own, artifactContent: selfContent };
  }
  for (const content of neighborMcpContents) {
    const program = extractLayercoopRefresh(content);
    if (program) return { program, artifactContent: content };
  }
  return null;
}

const AsyncFunction = Object.getPrototypeOf(async function () {
  return undefined;
}).constructor as new (...args: string[]) => (
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) => Promise<unknown>;

/** Исполняет сгенерированный MCP-код. В песочнице только callTool. */
export async function runRefreshSource(
  source: string,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<ViewSpec | null> {
  const body = source.trim();
  if (!body) return null;
  const fn = new AsyncFunction('callTool', `"use strict";\n${body}`);
  const raw = await fn(async (name, args) => callTool(String(name), args ?? {}));
  return parseViewSpec(raw);
}
