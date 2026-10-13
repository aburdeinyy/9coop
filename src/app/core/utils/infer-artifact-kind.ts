import type { ArtifactKind } from '../models/graph.model';

const KIND_ALIASES: Record<string, ArtifactKind> = {
  mcp: 'mcp',
  skill: 'skill',
  agent: 'agent',
  rule: 'rule',
  pawn: 'pawn',
  скилл: 'skill',
  скил: 'skill',
  агент: 'agent',
  правило: 'rule',
  паун: 'pawn',
};

/** Явное «тип: mcp», «нужен skill», «создай agent»… */
function explicitKind(prompt: string): ArtifactKind | null {
  const typed = prompt.match(
    /(?:тип|type|kind)\s*[:=]\s*(mcp|skill|agent|rule|pawn|скилл|скил|агент|правило|паун)\b/i,
  );
  if (typed?.[1]) {
    return KIND_ALIASES[typed[1].toLowerCase()] ?? null;
  }

  const need = prompt.match(
    /(?:нужен|нужна|нужно|создай|создать|добавь|добавить|сделай|сделать|хочу)\s+(?:ноду\s+)?(mcp|skill|agent|rule|pawn|скилл|скил|агент|правило|паун)\b/i,
  );
  if (need?.[1]) {
    return KIND_ALIASES[need[1].toLowerCase()] ?? null;
  }

  // leading token: "mcp: …" / "skill — …"
  const lead = prompt.match(
    /^\s*(mcp|skill|agent|rule|pawn|скилл|скил|агент|правило|паун)\s*[—\-:]\s+/i,
  );
  if (lead?.[1]) {
    return KIND_ALIASES[lead[1].toLowerCase()] ?? null;
  }

  return null;
}

function scoreKind(text: string): Record<ArtifactKind, number> {
  const t = text.toLowerCase();
  const scores: Record<ArtifactKind, number> = {
    skill: 0,
    mcp: 0,
    agent: 0,
    rule: 0,
    pawn: 0,
    repo: 0,
  };

  if (/\bmcp\b/.test(t) || /mcp[-\s]?server/.test(t) || /stdio/.test(t)) scores.mcp += 4;
  if (/server-everything|modelcontextprotocol|mcp\.json|mcp\.d\//.test(t)) scores.mcp += 3;
  if (/npx\s+.*mcp|atlassian-.*mcp|tools?\s*сервер/.test(t)) scores.mcp += 2;

  if (/\brule\b/.test(t) || /правил[оа]/.test(t) || /alwaysapply|always apply/.test(t)) {
    scores.rule += 4;
  }
  if (/всегда\s+(пиши|делай|используй)/.test(t) && /тест|tdd|lint/.test(t)) scores.rule += 2;

  if (/\bpawn\b/.test(t) || /вспомогательн[а-яёa-z]*\s+llm/i.test(t) || /corp\s+llm/.test(t)) {
    scores.pawn += 4;
  }
  if (/openai-compatible|base\s*url|делегир[а-яё]*\s+задач/i.test(t) && /llm|модел/i.test(t)) {
    scores.pawn += 2;
  }
  if (/для\s+corp\s+endpoint|corp\s+endpoint/.test(t) && /llm/i.test(t)) scores.pawn += 3;

  if (/\bagent\b/.test(t) || /\bагент\b/.test(t)) scores.agent += 3;
  if (/ревью|reviewer|code review|оркестрац/.test(t) && !/\bmcp\b/.test(t)) scores.agent += 2;

  if (/\bskill\b/.test(t) || /скилл/.test(t) || /workflow/.test(t) || /capability/.test(t)) {
    scores.skill += 3;
  }
  if (/анализ|поиск|отвеч|markdown|инструкц/.test(t)) scores.skill += 1;

  return scores;
}

/** Определяет тип ноды по промпту пользователя. */
export function inferArtifactKind(prompt: string): ArtifactKind {
  const trimmed = prompt.trim();
  if (!trimmed) return 'skill';

  const explicit = explicitKind(trimmed);
  if (explicit) return explicit;

  const scores = scoreKind(trimmed);
  let best: ArtifactKind = 'skill';
  let bestScore = -1;
  for (const kind of Object.keys(scores) as ArtifactKind[]) {
    if (scores[kind] > bestScore) {
      best = kind;
      bestScore = scores[kind];
    }
  }
  return bestScore > 0 ? best : 'skill';
}

const DEFAULT_LABELS = new Set([
  'новая нода',
  'new node',
  'new skill',
  'new mcp',
  'new agent',
  'new rule',
  'new pawn',
  'new pawn llm',
]);

export function isDefaultArtifactLabel(label: string): boolean {
  return DEFAULT_LABELS.has(label.trim().toLowerCase());
}

/** Короткий label из первой смысловой фразы промпта. */
export function suggestArtifactLabel(prompt: string, kind: ArtifactKind): string {
  const trimmed = prompt.trim();
  if (!trimmed) return 'Новая нода';

  let text = trimmed
    .replace(
      /^(?:тип|type|kind)\s*[:=]\s*(?:mcp|skill|agent|rule|pawn|скилл|скил|агент|правило|паун)\s*[—\-:,.]?\s*/i,
      '',
    )
    .replace(
      /^(?:нужен|нужна|нужно|создай|создать|добавь|добавить|сделай|сделать|хочу)\s+(?:ноду\s+)?(?:mcp|skill|agent|rule|pawn|скилл|скил|агент|правило|паун)\s*[—\-:,.]?\s*/i,
      '',
    )
    .replace(/^(?:mcp|skill|agent|rule|pawn)\s*[—\-:]\s*/i, '')
    .trim();

  if (!text) {
    return kind === 'pawn' ? 'New pawn LLM' : `New ${kind}`;
  }

  // First line / clause
  text = text.split(/\n/)[0] ?? text;
  text = text.replace(/^для\s+/i, '');
  if (text.length > 48) text = `${text.slice(0, 45).trim()}…`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
