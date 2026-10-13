/**
 * Уточняющий wizard при генерации skill/mcp/agent/rule/pawn.
 * LLM кладёт вопрос или итог в fence ```layercoop-wizard; UI рисует A/B/C.
 */

import type { ArtifactKind } from '../models/graph.model';

export interface WizardOption {
  id: string;
  label: string;
}

export interface WizardQuestion {
  question: string;
  options: WizardOption[];
  step?: number;
  total?: number;
}

export interface WizardDone {
  done: true;
  label: string;
  prompt: string;
  kind?: ArtifactKind;
  /** Куда сохранить: `save:home` | `save:repo:<nodeId>` */
  saveTarget?: string;
}

const ARTIFACT_KINDS = new Set<ArtifactKind>(['skill', 'mcp', 'agent', 'rule', 'pawn']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Допускаем ```layercoop-wizard и сразу JSON на той же/следующей строке. */
const WIZARD_FENCE_RE = /```layercoop-wizard\s*\n?([\s\S]*?)```/i;
const MAX_OPTIONS = 6;

function parseOption(raw: unknown): WizardOption | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  const label = typeof raw['label'] === 'string' ? raw['label'].trim() : '';
  if (!id || !label) return null;
  return { id: id.slice(0, 8), label: label.slice(0, 160) };
}

export function parseWizardQuestion(raw: unknown): WizardQuestion | null {
  if (!isRecord(raw)) return null;
  if (raw['done'] === true) return null;
  const question = typeof raw['question'] === 'string' ? raw['question'].trim() : '';
  if (!question) return null;
  if (!Array.isArray(raw['options'])) return null;
  const options = raw['options']
    .map(parseOption)
    .filter((item): item is WizardOption => item !== null)
    .slice(0, MAX_OPTIONS);
  if (options.length < 2) return null;

  const step = typeof raw['step'] === 'number' && Number.isFinite(raw['step']) ? Math.round(raw['step']) : undefined;
  const total = typeof raw['total'] === 'number' && Number.isFinite(raw['total']) ? Math.round(raw['total']) : undefined;
  const result: WizardQuestion = { question, options };
  if (step && step > 0) result.step = step;
  if (total && total > 0) result.total = total;
  return result;
}

export function parseWizardDone(raw: unknown): WizardDone | null {
  if (!isRecord(raw) || raw['done'] !== true) return null;
  const label = typeof raw['label'] === 'string' ? raw['label'].trim() : '';
  const prompt = typeof raw['prompt'] === 'string' ? raw['prompt'].trim() : '';
  if (!label || !prompt) return null;
  const result: WizardDone = {
    done: true,
    label: label.slice(0, 80),
    prompt: prompt.slice(0, 4000),
  };
  const kind = typeof raw['kind'] === 'string' ? raw['kind'].trim().toLowerCase() : '';
  if (ARTIFACT_KINDS.has(kind as ArtifactKind)) result.kind = kind as ArtifactKind;
  const saveTarget =
    typeof raw['saveTarget'] === 'string' ? raw['saveTarget'].trim() : '';
  if (saveTarget) result.saveTarget = saveTarget.slice(0, 120);
  return result;
}

function parseWizardFenceJson(reply: string): unknown | null {
  const match = reply.match(WIZARD_FENCE_RE);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

export function extractLayercoopWizard(reply: string): WizardQuestion | null {
  return parseWizardQuestion(parseWizardFenceJson(reply));
}

export function extractWizardDone(reply: string): WizardDone | null {
  return parseWizardDone(parseWizardFenceJson(reply));
}

export function stripLayercoopWizardFence(reply: string): string {
  return reply.replace(WIZARD_FENCE_RE, '').trim();
}

/**
 * Вопрос wizard оставляем в content (UI рисует A/B/C).
 * Fence с done:true убираем после применения на ноду.
 */
export function stripWizardFenceIfDone(reply: string): string {
  if (extractWizardDone(reply)) return stripLayercoopWizardFence(reply);
  return reply;
}

export function formatWizardPick(option: WizardOption): string {
  return `${option.id.trim().toUpperCase()} — ${option.label.trim()}`;
}
