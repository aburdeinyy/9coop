import type { ChatRunStats, ChatTokenUsage } from '../models/graph.model';

function finiteNonNeg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeTokenUsage(raw: unknown): ChatTokenUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const inputTokens = finiteNonNeg(o['inputTokens']) ?? 0;
  const outputTokens = finiteNonNeg(o['outputTokens']) ?? 0;
  const cacheReadTokens = finiteNonNeg(o['cacheReadTokens']) ?? 0;
  const cacheWriteTokens = finiteNonNeg(o['cacheWriteTokens']) ?? 0;
  const reasoningTokens = finiteNonNeg(o['reasoningTokens']);
  const totalTokens =
    finiteNonNeg(o['totalTokens']) ??
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

export function normalizeChatRunStats(raw: unknown): ChatRunStats | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const durationMs = finiteNonNeg(o['durationMs']);
  const usage = normalizeTokenUsage(o['usage']);
  if (durationMs === undefined && !usage) return undefined;
  return {
    durationMs: durationMs ?? 0,
    ...(usage ? { usage } : {}),
  };
}

export function sumTokenUsage(
  a?: ChatTokenUsage | null,
  b?: ChatTokenUsage | null,
): ChatTokenUsage | undefined {
  if (!a && !b) return undefined;
  if (!a) return b ?? undefined;
  if (!b) return a;
  const reasoning =
    (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) || undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
    totalTokens: a.totalTokens + b.totalTokens,
    ...(reasoning ? { reasoningTokens: reasoning } : {}),
  };
}

export function mergeRunStats(
  a?: ChatRunStats | null,
  b?: ChatRunStats | null,
): ChatRunStats | undefined {
  if (!a && !b) return undefined;
  if (!a) return b ?? undefined;
  if (!b) return a;
  const usage = sumTokenUsage(a.usage, b.usage);
  return {
    durationMs: (a.durationMs ?? 0) + (b.durationMs ?? 0),
    ...(usage ? { usage } : {}),
  };
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 100) * 100)}мс`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s < 10 ? s.toFixed(1) : Math.round(s)}с`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}м ${s}с` : `${m}м`;
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function formatRunStatsLabel(stats: ChatRunStats): string {
  const parts: string[] = [];
  if (stats.durationMs > 0) parts.push(formatDurationMs(stats.durationMs));
  if (stats.usage) {
    const u = stats.usage;
    parts.push(`${formatTokenCount(u.totalTokens)} tok`);
    parts.push(`(in ${formatTokenCount(u.inputTokens)} / out ${formatTokenCount(u.outputTokens)})`);
  }
  return parts.join(' · ');
}

export type RunStatsBarSegment = {
  key: 'input' | 'output' | 'cache' | 'reasoning';
  label: string;
  pct: number;
  value: number;
};

export function runStatsBarSegments(usage: ChatTokenUsage): RunStatsBarSegment[] {
  const input = usage.inputTokens;
  const output = Math.max(0, usage.outputTokens - (usage.reasoningTokens ?? 0));
  const reasoning = usage.reasoningTokens ?? 0;
  const cache = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const raw = [
    { key: 'input' as const, label: 'in', value: input },
    { key: 'output' as const, label: 'out', value: output },
    { key: 'reasoning' as const, label: 'think', value: reasoning },
    { key: 'cache' as const, label: 'cache', value: cache },
  ].filter((s) => s.value > 0);
  const sum = raw.reduce((s, x) => s + x.value, 0) || 1;
  const segs = raw.map((s) => ({ ...s, pct: Math.round((s.value / sum) * 100) }));
  const drift = 100 - segs.reduce((s, x) => s + x.pct, 0);
  if (segs.length && drift !== 0) {
    segs[0] = { ...segs[0]!, pct: segs[0]!.pct + drift };
  }
  return segs;
}
