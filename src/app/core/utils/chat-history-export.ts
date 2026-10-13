import type { ChatMessage, ChatRunStep } from '../models/graph.model';
import { formatRunStatsLabel } from './run-stats';

export type HistoryExportFormat = 'md' | 'json';

export type ChatHistoryExportInput = {
  graphName: string;
  nodeId: string;
  nodeLabel: string;
  nodeKind: string;
  threadId: string;
  threadTitle: string;
  exportedAt: string;
  messages: ChatMessage[];
  /** Опционально: runner/model фокус-ноды */
  runner?: string;
  model?: string;
};

export type ChatHistoryDocument = {
  markdown: string;
  json: Record<string, unknown>;
};

/** Только целое сообщение-команда, не упоминание в тексте. */
export function isHistoryCommand(text: string): HistoryExportFormat | null {
  const t = text.trim();
  if (/^\/history(?:\s+json)?$/i.test(t)) {
    return /\bjson$/i.test(t) ? 'json' : 'md';
  }
  return null;
}

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'chat';
}

export function chatHistoryFilename(
  graphName: string,
  nodeLabel: string,
  threadId: string,
  format: HistoryExportFormat,
  now = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = format === 'json' ? 'json' : 'md';
  return `layercoop-history-${slugPart(graphName)}-${slugPart(nodeLabel)}-${slugPart(threadId)}-${stamp}.${ext}`;
}

function formatStep(step: ChatRunStep, index: number): string {
  const head =
    step.kind === 'tool'
      ? `### Step ${index + 1} — tool: ${step.label} (${step.status})`
      : `### Step ${index + 1} — thought (${step.status})`;
  const body = step.text?.trim()
    ? step.text.trim()
    : step.kind === 'tool'
      ? '_(no detail)_'
      : '_(empty)_';
  return `${head}\n\n${body}`;
}

function formatMessage(msg: ChatMessage, index: number): string {
  const role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
  const lines = [
    `## ${index + 1}. ${role}`,
    '',
    `- id: \`${msg.id}\``,
    `- time: ${msg.timestamp}`,
  ];
  if (msg.stats) {
    lines.push(`- stats: ${formatRunStatsLabel(msg.stats)}`);
  }
  lines.push('', '### Content', '', msg.content?.trim() || '_(empty)_');

  if (msg.steps?.length) {
    lines.push('', '### Run steps (thoughts / tools)', '');
    msg.steps.forEach((step, i) => {
      lines.push(formatStep(step, i), '');
    });
  }
  return lines.join('\n');
}

export function buildChatHistoryDocument(input: ChatHistoryExportInput): ChatHistoryDocument {
  const json = {
    version: 1,
    kind: 'layercoop-chat-history',
    exportedAt: input.exportedAt,
    graphName: input.graphName,
    node: {
      id: input.nodeId,
      label: input.nodeLabel,
      kind: input.nodeKind,
      ...(input.runner ? { runner: input.runner } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
    thread: {
      id: input.threadId,
      title: input.threadTitle,
    },
    messageCount: input.messages.length,
    messages: input.messages.map((m) => ({
      id: m.id,
      role: m.role,
      timestamp: m.timestamp,
      content: m.content,
      ...(m.steps?.length ? { steps: m.steps } : {}),
      ...(m.stats ? { stats: m.stats } : {}),
    })),
  };

  const meta = [
    `- exportedAt: ${input.exportedAt}`,
    `- graph: ${input.graphName}`,
    `- node: ${input.nodeLabel} (\`${input.nodeId}\`, ${input.nodeKind})`,
    input.runner ? `- runner: ${input.runner}` : null,
    input.model ? `- model: ${input.model}` : null,
    `- thread: ${input.threadTitle} (\`${input.threadId}\`)`,
    `- messages: ${input.messages.length}`,
  ].filter((line): line is string => line != null);

  const md = [
    '# Layercoop chat history',
    '',
    'Полный лог треда для анализа работы LLM: промпты пользователя, ответы, ход мыслей и tool-calls.',
    '',
    '## Meta',
    '',
    ...meta,
    '',
    '---',
    '',
    ...input.messages.map((m, i) => formatMessage(m, i)),
    '',
    '---',
    '',
    '## Machine-readable JSON',
    '',
    '```json',
    JSON.stringify(json, null, 2),
    '```',
    '',
  ].join('\n');

  return { markdown: md, json };
}
