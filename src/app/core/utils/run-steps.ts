import type { ChatRunStep } from '../models/graph.model';
import { formatToolStepLabel } from './tool-label';

export type { ChatRunStep };

export type RunStepEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool';
      name: string;
      status: 'start' | 'end';
      callId?: string;
      detail?: string;
    };

function findLastIndex(steps: ChatRunStep[], pred: (s: ChatRunStep) => boolean): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (pred(steps[i]!)) return i;
  }
  return -1;
}

/** Сводит SSE token/tool в шаги чата (последний — текущий). */
export function reduceRunSteps(
  steps: ChatRunStep[],
  event: RunStepEvent,
  nextId: () => string = () => `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): ChatRunStep[] {
  const next = steps.slice();

  if (event.type === 'token') {
    const last = next[next.length - 1];
    if (last?.kind === 'thought' && last.status === 'running') {
      next[next.length - 1] = { ...last, text: last.text + event.text };
      return next;
    }
    next.push({
      id: nextId(),
      kind: 'thought',
      label: 'Мысль',
      text: event.text,
      status: 'running',
    });
    return next;
  }

  if (event.status === 'start') {
    const openThought = findLastIndex(
      next,
      (s) => s.kind === 'thought' && s.status === 'running',
    );
    if (openThought >= 0) {
      next[openThought] = { ...next[openThought]!, status: 'done' };
    }
    next.push({
      id: event.callId || nextId(),
      kind: 'tool',
      label: event.detail?.trim() || formatToolStepLabel(event.name),
      text: '',
      status: 'running',
    });
    return next;
  }

  const idx = event.callId
    ? next.findIndex((s) => s.id === event.callId)
    : findLastIndex(next, (s) => s.kind === 'tool' && s.status === 'running');
  if (idx >= 0) {
    const prev = next[idx]!;
    const label = event.detail?.trim() || prev.label;
    next[idx] = { ...prev, status: 'done', label };
  }
  return next;
}

export function finalizeRunSteps(steps: ChatRunStep[]): ChatRunStep[] {
  return steps.map((s) => (s.status === 'running' ? { ...s, status: 'done' as const } : s));
}

/** Короткий превью для свёрнутой гармошки. */
export function runStepPreview(step: ChatRunStep, max = 72): string {
  if (step.kind === 'tool') {
    return step.status === 'running' ? `${step.label}…` : step.label;
  }
  const t = step.text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t || '…';
  return `${t.slice(0, max - 1)}…`;
}
