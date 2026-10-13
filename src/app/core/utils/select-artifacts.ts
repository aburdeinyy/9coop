import type { ArtifactKind } from '../models/graph.model';
import type { ConnectedArtifact } from './compose-context';

export interface SelectArtifactsOptions {
  /** Artifact в фокусе чата — всегда с полным текстом. */
  focusId?: string;
  /** Сколько scored skill/agent/pawn брать (помимо always). */
  limit?: number;
}

const ALWAYS_KINDS = new Set<ArtifactKind>(['mcp', 'rule']);

/** Токены для скоринга: буквы/цифры, длина ≥ 2 (кроме чисто числовых id вроде «1»). */
export function tokenizeForSelect(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
}

export function scoreArtifact(artifact: ConnectedArtifact, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const label = artifact.label.toLowerCase();
  const prompt = artifact.prompt.toLowerCase();
  const kind = artifact.kind.toLowerCase();
  const hay = `${label} ${prompt} ${kind}`;
  const labelTokens = new Set(tokenizeForSelect(artifact.label));

  let score = 0;
  for (const t of queryTokens) {
    if (hay.includes(t)) score += 1;
    if (labelTokens.has(t)) score += 2;
  }
  return score;
}

/**
 * Пул = linked артефакты. Полный контент: mcp+rule+focus всегда;
 * skill/agent/pawn — top-K по релевантности к userPrompt.
 * Если никто не набрал score > 0 — весь пул (безопасный fallback).
 */
export function selectArtifactsForPrompt(
  artifacts: ConnectedArtifact[],
  userPrompt: string,
  options: SelectArtifactsOptions = {},
): ConnectedArtifact[] {
  if (artifacts.length === 0) return [];
  const limit = options.limit ?? 3;
  const focusId = options.focusId;
  const tokens = tokenizeForSelect(userPrompt);

  const always = artifacts.filter(
    (a) => ALWAYS_KINDS.has(a.kind) || (focusId != null && a.id === focusId),
  );
  const alwaysIds = new Set(always.map((a) => a.id));

  const ranked = artifacts
    .filter((a) => !alwaysIds.has(a.id))
    .map((a) => ({ a, score: scoreArtifact(a, tokens) }))
    .sort((x, y) => y.score - x.score || x.a.label.localeCompare(y.a.label, 'ru'));

  const best = ranked[0]?.score ?? 0;
  if (best <= 0) return artifacts;

  const pickedIds = new Set<string>([
    ...alwaysIds,
    ...ranked
      .filter((r) => r.score > 0)
      .slice(0, limit)
      .map((r) => r.a.id),
  ]);

  return artifacts.filter((a) => pickedIds.has(a.id));
}
