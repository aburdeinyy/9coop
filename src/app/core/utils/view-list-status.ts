/** Статус list-item из meta (pipeline job / MR approval) → иконка на плитке. */

/** Сводка «pipeline #N» на плитке не нужна — только jobs / approval / MR. */
export function isPipelineSummaryText(text: string): boolean {
  return /^pipeline\s*#\d+/i.test(text.trim());
}

export function withoutPipelineSummaryItems<T extends { text: string }>(items: T[]): T[] {
  return items.filter((item) => !isPipelineSummaryText(item.text));
}

export type ViewListStatusKind =
  | 'success'
  | 'failed'
  | 'running'
  | 'pending'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'approved'
  | 'unapproved';

export type ViewListStatusTone = 'ok' | 'err' | 'run' | 'muted' | 'warn';

export interface ViewListStatus {
  kind: ViewListStatusKind;
  label: string;
}

const KIND_ICON: Record<ViewListStatusKind, string> = {
  success: '✓',
  failed: '✕',
  running: '◐',
  pending: '○',
  canceled: '⊘',
  skipped: '–',
  manual: '◉',
  approved: '✓',
  unapproved: '○',
};

const KIND_TONE: Record<ViewListStatusKind, ViewListStatusTone> = {
  success: 'ok',
  failed: 'err',
  running: 'run',
  pending: 'muted',
  canceled: 'muted',
  skipped: 'muted',
  manual: 'warn',
  approved: 'ok',
  unapproved: 'warn',
};

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** approvals: 1/1 → approved; approvals: 0/2 → unapproved */
function parseApprovalsRatio(s: string): ViewListStatus | null {
  const m = s.match(/approvals?\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i);
  if (!m) return null;
  const got = Number(m[1]);
  const need = Number(m[2]);
  if (!Number.isFinite(got) || !Number.isFinite(need) || need <= 0) return null;
  if (got >= need) {
    return { kind: 'approved', label: m[0] };
  }
  return { kind: 'unapproved', label: m[0] };
}

function matchKind(s: string): ViewListStatus | null {
  const ratio = parseApprovalsRatio(s);
  if (ratio) return ratio;

  if (/\bapproved\b/.test(s) && !/\bunapproved\b/.test(s) && !/\bnot approved\b/.test(s)) {
    return { kind: 'approved', label: s };
  }
  if (
    /\bunapproved\b/.test(s) ||
    /\bno approvals?\b/.test(s) ||
    /\bwaiting for approval\b/.test(s) ||
    /\bnot approved\b/.test(s) ||
    /\bneeds? approval\b/.test(s)
  ) {
    return { kind: 'unapproved', label: s };
  }

  // точные / слово-статусы GitLab
  const token = s.split(/[|,•·]/)[0]?.trim() ?? s;
  const map: Array<[RegExp, ViewListStatusKind]> = [
    [/^(success|passed|ok|done)$/, 'success'],
    [/^(failed|failure|error)$/, 'failed'],
    [/^(running|in_progress|in progress)$/, 'running'],
    [/^(pending|created|waiting|queued)$/, 'pending'],
    [/^(canceled|cancelled)$/, 'canceled'],
    [/^(skipped)$/, 'skipped'],
    [/^(manual)$/, 'manual'],
  ];
  for (const [re, kind] of map) {
    if (re.test(token)) return { kind, label: token };
  }

  // meta вида "job success" / "status: failed"
  if (/\bsuccess\b|\bpassed\b/.test(s)) return { kind: 'success', label: s };
  if (/\bfailed\b|\bfailure\b/.test(s)) return { kind: 'failed', label: s };
  if (/\brunning\b/.test(s)) return { kind: 'running', label: s };
  if (/\bpending\b|\bcreated\b/.test(s)) return { kind: 'pending', label: s };
  if (/\bcancell?ed\b/.test(s)) return { kind: 'canceled', label: s };
  if (/\bskipped\b/.test(s)) return { kind: 'skipped', label: s };
  if (/\bmanual\b/.test(s)) return { kind: 'manual', label: s };

  return null;
}

/**
 * Разбирает meta (приоритет) list-item в статус для иконки.
 * text не используется как источник статуса — только meta.
 */
export function parseViewListStatus(
  meta?: string | null,
  _text?: string | null,
): ViewListStatus | null {
  if (meta == null || !String(meta).trim()) return null;
  return matchKind(normalize(String(meta)));
}

export function viewListStatusIcon(status: ViewListStatus): string {
  return KIND_ICON[status.kind];
}

export function viewListStatusTone(status: ViewListStatus): ViewListStatusTone {
  return KIND_TONE[status.kind];
}
