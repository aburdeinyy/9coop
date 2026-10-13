import type {
  ViewChecklistItem,
  ViewKvRow,
  ViewListItem,
  ViewSpec,
} from '../models/node-view.model';
import { VIEW_MAX_ITEMS, VIEW_PREVIEW_LIMIT } from '../models/node-view.model';
import { isPipelineSummaryText, withoutPipelineSummaryItems } from './view-list-status';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only http(s) links — drop javascript:, data:, etc. */
export function sanitizeViewHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseListItem(raw: unknown): ViewListItem | null {
  if (!isRecord(raw) || typeof raw['text'] !== 'string' || !raw['text'].trim()) return null;
  const text = raw['text'].trim();
  if (isPipelineSummaryText(text)) return null;
  const item: ViewListItem = { text };
  const href = sanitizeViewHref(raw['href']);
  if (href) item.href = href;
  if (typeof raw['meta'] === 'string' && raw['meta'].trim()) item.meta = raw['meta'].trim();
  return item;
}

function parseKvRow(raw: unknown): ViewKvRow | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['key'] !== 'string' || typeof raw['value'] !== 'string') return null;
  const row: ViewKvRow = { key: raw['key'], value: raw['value'] };
  const href = sanitizeViewHref(raw['href']);
  if (href) row.href = href;
  return row;
}

function uniqueChecklistId(raw: unknown, index: number, used: Set<string>): string {
  const cleaned =
    typeof raw === 'string' ? raw.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : '';
  const base = cleaned || `c${index + 1}`;
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n++}`;
  }
  used.add(id);
  return id;
}

function parseChecklistItem(
  raw: unknown,
  index: number,
  used: Set<string>,
): ViewChecklistItem | null {
  if (!isRecord(raw) || typeof raw['text'] !== 'string' || !raw['text'].trim()) return null;
  const item: ViewChecklistItem = {
    id: uniqueChecklistId(raw['id'], index, used),
    text: raw['text'].trim(),
    checked: raw['checked'] === true,
  };
  const href = sanitizeViewHref(raw['href']);
  if (href) item.href = href;
  return item;
}

/** Strip crude HTML tags from markdown body (no raw HTML in MVP). */
export function stripHtmlTags(body: string): string {
  return body.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

export function parseViewSpec(raw: unknown): ViewSpec | null {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return null;
  const title = typeof raw['title'] === 'string' && raw['title'].trim() ? raw['title'].trim() : undefined;

  if (raw['type'] === 'list') {
    if (!Array.isArray(raw['items'])) return null;
    const items = raw['items']
      .map(parseListItem)
      .filter((x): x is ViewListItem => x !== null)
      .slice(0, VIEW_MAX_ITEMS);
    if (items.length === 0) return null;
    return title ? { type: 'list', title, items } : { type: 'list', items };
  }

  if (raw['type'] === 'checklist') {
    if (!Array.isArray(raw['items'])) return null;
    const used = new Set<string>();
    const items = raw['items']
      .map((item, index) => parseChecklistItem(item, index, used))
      .filter((x): x is ViewChecklistItem => x !== null)
      .slice(0, VIEW_MAX_ITEMS);
    return title ? { type: 'checklist', title, items } : { type: 'checklist', items };
  }

  if (raw['type'] === 'kv') {
    if (!Array.isArray(raw['rows'])) return null;
    const rows = raw['rows']
      .map(parseKvRow)
      .filter((x): x is ViewKvRow => x !== null)
      .slice(0, VIEW_MAX_ITEMS);
    if (rows.length === 0) return null;
    return title ? { type: 'kv', title, rows } : { type: 'kv', rows };
  }

  if (raw['type'] === 'markdown') {
    if (typeof raw['body'] !== 'string' || !raw['body'].trim()) return null;
    const body = stripHtmlTags(raw['body'].trim());
    return title ? { type: 'markdown', title, body } : { type: 'markdown', body };
  }

  return null;
}

const VIEW_FENCE_RE = /```layercoop-view\s*\n([\s\S]*?)```/i;

export type ExtractedLayercoopView = {
  view: ViewSpec;
  /** true → UI создаёт отдельную ноду на доске (MR pipeline и т.п.). */
  spawn: boolean;
};

/** Fence + флаг spawn из JSON (не хранится в ViewSpec на плитке). */
export function extractLayercoopViewFence(reply: string): ExtractedLayercoopView | null {
  const match = reply.match(VIEW_FENCE_RE);
  if (!match?.[1]) return null;
  try {
    const raw = JSON.parse(match[1].trim()) as unknown;
    const view = parseViewSpec(raw);
    if (!view) return null;
    const spawn =
      !!raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as Record<string, unknown>)['spawn'] === true;
    return { view, spawn };
  } catch {
    return null;
  }
}

export function extractLayercoopView(reply: string): ViewSpec | null {
  return extractLayercoopViewFence(reply)?.view ?? null;
}

/** Strip the view fence from chat text shown to the user. */
export function stripLayercoopViewFence(reply: string): string {
  return reply.replace(VIEW_FENCE_RE, '').trim();
}

/** Если fence валиден — заменить на читаемый список в чате (не терять данные). */
export function materializeViewFenceForChat(reply: string, previewLimit = 40): string {
  const match = reply.match(VIEW_FENCE_RE);
  if (!match) return reply;
  const view = extractLayercoopView(reply);
  if (!view) return stripLayercoopViewFence(reply);
  const block = formatViewAsChatText(view, previewLimit);
  return reply.replace(VIEW_FENCE_RE, `\n${block}\n`).trim();
}

export function formatViewAsChatText(view: ViewSpec, previewLimit = 40): string {
  const cap = Math.max(1, Math.min(VIEW_MAX_ITEMS, Math.floor(previewLimit)));
  const lines: string[] = [];
  if (view.title?.trim()) lines.push(`**${view.title.trim()}**`);

  if (view.type === 'list') {
    const slice = view.items.slice(0, cap);
    for (const item of slice) {
      lines.push(item.href ? `- [${item.text}](${item.href})` : `- ${item.text}`);
    }
    const more = view.items.length - slice.length;
    if (more > 0) lines.push(`…и ещё ${more}`);
    return lines.join('\n');
  }

  if (view.type === 'checklist') {
    const slice = view.items.slice(0, cap);
    for (const item of slice) {
      const mark = item.checked ? '[x]' : '[ ]';
      lines.push(item.href ? `- ${mark} [${item.text}](${item.href})` : `- ${mark} ${item.text}`);
    }
    const more = view.items.length - slice.length;
    if (more > 0) lines.push(`…и ещё ${more}`);
    return lines.join('\n');
  }

  if (view.type === 'kv') {
    const slice = view.rows.slice(0, cap);
    for (const row of slice) {
      lines.push(row.href ? `- **${row.key}**: [${row.value}](${row.href})` : `- **${row.key}**: ${row.value}`);
    }
    const more = view.rows.length - slice.length;
    if (more > 0) lines.push(`…и ещё ${more}`);
    return lines.join('\n');
  }

  const body = view.body.trim();
  const truncated = body.length > 2000 ? `${body.slice(0, 2000)}…` : body;
  lines.push(truncated);
  return lines.join('\n');
}

/** Оценка: сколько строк list/kv влезает в compact-превью при данной высоте ноды. */
export const COMPACT_LINE_H = 15;
export const COMPACT_CHROME_BASE = 40; // padding + node title + view margin
export const COMPACT_VIEW_TITLE_H = 18;
export const COMPACT_MORE_H = 12;

export function compactPreviewLimit(
  nodeHeight: number,
  opts: { hasTitle?: boolean; totalItems?: number } = {},
): number {
  const chrome = COMPACT_CHROME_BASE + (opts.hasTitle ? COMPACT_VIEW_TITLE_H : 0);
  const available = Math.max(0, Math.round(nodeHeight) - chrome);
  let limit = Math.floor(available / COMPACT_LINE_H);

  const total = opts.totalItems;
  if (total != null && limit < total) {
    limit = Math.floor(Math.max(0, available - COMPACT_MORE_H) / COMPACT_LINE_H);
  }

  return Math.min(VIEW_MAX_ITEMS, Math.max(VIEW_PREVIEW_LIMIT, limit));
}

export function viewPreviewItems(
  view: ViewSpec,
  limit: number = VIEW_PREVIEW_LIMIT,
): {
  title?: string;
  lines: Array<{ text: string; href?: string; meta?: string; checked?: boolean; id?: string }>;
  more: number;
} {
  const cap = Math.max(1, Math.min(VIEW_MAX_ITEMS, Math.floor(limit)));
  if (view.type === 'checklist') {
    const lines = view.items.slice(0, cap).map((i) => ({
      text: i.text,
      href: i.href,
      checked: i.checked,
      id: i.id,
    }));
    return { title: view.title, lines, more: Math.max(0, view.items.length - lines.length) };
  }
  if (view.type === 'list') {
    const items = withoutPipelineSummaryItems(view.items);
    const lines = items.slice(0, cap).map((i) => ({
      text: i.text,
      href: i.href,
      meta: i.meta,
    }));
    return { title: view.title, lines, more: Math.max(0, items.length - lines.length) };
  }
  if (view.type === 'kv') {
    const lines = view.rows.slice(0, cap).map((r) => ({
      text: `${r.key}: ${r.value}`,
      href: r.href,
    }));
    return { title: view.title, lines, more: Math.max(0, view.rows.length - lines.length) };
  }
  const bodyLines = view.body.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const shown = bodyLines.slice(0, Math.max(1, cap)).map((text) => ({
    text: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
  }));
  return {
    title: view.title,
    lines: shown,
    more: Math.max(0, bodyLines.length - shown.length),
  };
}

export function wantsChecklistView(prompt: string): boolean {
  return /чеклист|check[\s-]?list|to-?do\b|галочк/i.test(prompt);
}

export function wantsNodeView(prompt: string): boolean {
  return (
    wantsChecklistView(prompt) ||
    /покаж|плитк|список|дашборд|dashboard|show\s+me|tile|list\s+of/i.test(prompt)
  );
}

export function toggleChecklistItem(view: ViewSpec, itemId: string): ViewSpec {
  if (view.type !== 'checklist') return view;
  let changed = false;
  const items = view.items.map((item) => {
    if (item.id !== itemId) return item;
    changed = true;
    return { ...item, checked: !item.checked };
  });
  if (!changed) return view;
  return view.title
    ? { type: 'checklist', title: view.title, items }
    : { type: 'checklist', items };
}

export function appendChecklistItem(
  view: ViewSpec | null | undefined,
  text: string,
): ViewSpec | null {
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return view ?? null;
  if (view && view.type !== 'checklist') return view;
  if (!view) {
    return parseViewSpec({ type: 'checklist', items: [{ text: trimmed }] });
  }
  if (view.items.length >= VIEW_MAX_ITEMS) return view;
  const used = new Set(view.items.map((item) => item.id));
  const id = uniqueChecklistId(undefined, view.items.length, used);
  const items = [...view.items, { id, text: trimmed, checked: false }];
  return view.title
    ? { type: 'checklist', title: view.title, items }
    : { type: 'checklist', items };
}

export function removeChecklistItem(view: ViewSpec, itemId: string): ViewSpec | null {
  if (view.type !== 'checklist') return view;
  const items = view.items.filter((item) => item.id !== itemId);
  if (items.length === view.items.length) return view;
  return view.title
    ? { type: 'checklist', title: view.title, items }
    : { type: 'checklist', items };
}

export function demoViewFromPrompt(prompt: string): ViewSpec {
  const title = prompt.trim().slice(0, 48) || 'Плитка';
  if (wantsChecklistView(prompt)) {
    return {
      type: 'checklist',
      title,
      items: [
        { id: 'c1', text: 'Пункт 1', checked: false },
        { id: 'c2', text: 'Пункт 2', checked: false },
        { id: 'c3', text: 'Пункт 3', checked: false },
      ],
    };
  }
  return {
    type: 'list',
    title,
    items: [
      { text: 'Пример пункта 1', href: 'https://example.com/1', meta: 'demo' },
      { text: 'Пример пункта 2', href: 'https://example.com/2' },
      { text: 'Пример пункта 3', href: 'https://example.com/3' },
    ],
  };
}
