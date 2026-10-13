import { describe, expect, it } from 'vitest';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import { ARTIFACT_GENERATION_GUIDE } from '../src/app/core/utils/layercoop-architecture';
import {
  extractLayercoopWizard,
  extractWizardDone,
  formatWizardPick,
  parseWizardDone,
  parseWizardQuestion,
  stripLayercoopWizardFence,
  stripWizardFenceIfDone,
} from '../src/app/core/utils/node-wizard';
import { GraphService } from '../src/app/core/services/graph.service';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';

const graph: LayercoopGraph = {
  version: 1,
  name: 't',
  updatedAt: '2026-09-03T00:00:00.000Z',
  nodes: [
    {
      id: GOD_NODE_ID,
      type: 'god',
      position: { x: 0, y: 0 },
      data: defaultGodData(),
    },
  ],
  edges: [],
};

describe('node wizard', () => {
  it('parseWizardQuestion: вопрос + 2–6 вариантов A/B/C', () => {
    const parsed = parseWizardQuestion({
      step: 1,
      total: 4,
      question: 'Какой GitLab?',
      options: [
        { id: 'a', label: 'Self-hosted' },
        { id: 'b', label: 'gitlab.com' },
        { id: 'c', label: 'Другое' },
      ],
    });
    expect(parsed).toEqual({
      step: 1,
      total: 4,
      question: 'Какой GitLab?',
      options: [
        { id: 'a', label: 'Self-hosted' },
        { id: 'b', label: 'gitlab.com' },
        { id: 'c', label: 'Другое' },
      ],
    });
    expect(parseWizardQuestion({ question: 'x', options: [{ id: 'a', label: 'only' }] })).toBeNull();
    expect(parseWizardQuestion({ question: '', options: [] })).toBeNull();
  });

  it('extract/strip fence layercoop-wizard', () => {
    const reply = [
      'Уточню пару вещей.',
      '```layercoop-wizard',
      JSON.stringify({
        step: 1,
        total: 3,
        question: 'Что skill должен делать с GitLab?',
        options: [
          { id: 'a', label: 'MR / code review' },
          { id: 'b', label: 'Issues и board' },
          { id: 'c', label: 'CI/CD пайплайны' },
        ],
      }),
      '```',
    ].join('\n');
    const wiz = extractLayercoopWizard(reply);
    expect(wiz?.question).toContain('GitLab');
    expect(wiz?.options).toHaveLength(3);
    expect(stripLayercoopWizardFence(reply)).toBe('Уточню пару вещей.');
    expect(stripLayercoopWizardFence(reply)).not.toContain('layercoop-wizard');
  });

  it('formatWizardPick — ответ пользователя в чат', () => {
    expect(formatWizardPick({ id: 'a', label: 'Self-hosted' })).toBe('A — Self-hosted');
    expect(formatWizardPick({ id: '2', label: 'Issues' })).toBe('2 — Issues');
  });

  it('гайд и system prompt требуют wizard из 3–5 вопросов с вариантами', () => {
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/3\s*[–-]\s*5/);
    expect(ARTIFACT_GENERATION_GUIDE).toContain('layercoop-wizard');
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/вариант|options|A\/B/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/не генерир|не создавай файлы|не пиши артефакт/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/"done"\s*:\s*true/);
    expect(ARTIFACT_GENERATION_GUIDE).toContain('"label"');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('"prompt"');

    const { systemPrompt } = composeChatContext(graph, 'хочу скилл для работы с гитлабом');
    expect(systemPrompt).toContain('layercoop-wizard');
    expect(systemPrompt).toMatch(/один вопрос|по одному/i);
  });

  it('parseWizardDone: итог wizard заполняет label и prompt', () => {
    expect(parseWizardDone({ done: true })).toBeNull();
    const done = parseWizardDone({
      done: true,
      label: 'GitLab MR',
      prompt: 'Skill: ревью MR на self-hosted GitLab через MCP.',
      kind: 'skill',
    });
    expect(done).toEqual({
      done: true,
      label: 'GitLab MR',
      prompt: 'Skill: ревью MR на self-hosted GitLab через MCP.',
      kind: 'skill',
    });
    const reply = [
      'Готово, собираю skill.',
      '```layercoop-wizard',
      JSON.stringify(done),
      '```',
    ].join('\n');
    expect(extractLayercoopWizard(reply)).toBeNull();
    expect(extractWizardDone(reply)).toMatchObject({ label: 'GitLab MR', kind: 'skill' });
    expect(stripLayercoopWizardFence(reply)).toBe('Готово, собираю skill.');
  });

  it('stripWizardFenceIfDone: вопрос оставляет fence, done — убирает', () => {
    const question = [
      'Уточню.',
      '```layercoop-wizard',
      JSON.stringify({
        question: 'Для какого типа ответов?',
        options: [
          { id: 'a', label: 'Все ответы' },
          { id: 'b', label: 'Только спеки' },
        ],
      }),
      '```',
    ].join('\n');
    expect(stripWizardFenceIfDone(question)).toContain('layercoop-wizard');
    expect(extractLayercoopWizard(stripWizardFenceIfDone(question))?.options).toHaveLength(2);

    const done = [
      'Готово.',
      '```layercoop-wizard',
      JSON.stringify({
        done: true,
        label: 'ASD',
        prompt: 'STE100',
        kind: 'skill',
      }),
      '```',
    ].join('\n');
    expect(stripWizardFenceIfDone(done)).toBe('Готово.');
    expect(stripWizardFenceIfDone(done)).not.toContain('layercoop-wizard');
  });

  it('GraphService.applyWizardResult пишет название и спеку на ноду', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const id = svc.addArtifactNode();
    svc.applyWizardResult(id, {
      done: true,
      label: 'GitLab MR',
      prompt: 'Skill: ревью merge request в корпоративном GitLab.',
      kind: 'skill',
    });
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.label).toBe('GitLab MR');
    expect(node.data.prompt).toContain('ревью merge request');
    expect(node.data.kind).toBe('skill');
  });
});
