import { describe, expect, it } from 'vitest';
import {
  inferArtifactKind,
  suggestArtifactLabel,
  isDefaultArtifactLabel,
} from '../src/app/core/utils/infer-artifact-kind';
import { GraphService } from '../src/app/core/services/graph.service';
import { ARTIFACT_KIND_LABELS } from '../src/app/core/models/graph.model';

describe('inferArtifactKind', () => {
  it('явное указание типа в промпте', () => {
    expect(inferArtifactKind('тип: mcp — confluence wiki')).toBe('mcp');
    expect(inferArtifactKind('нужен skill для Jira анализа')).toBe('skill');
    expect(inferArtifactKind('создай agent code reviewer')).toBe('agent');
    expect(inferArtifactKind('добавь rule: всегда TDD')).toBe('rule');
    expect(inferArtifactKind('pawn для corp LLM')).toBe('pawn');
  });

  it('эвристики по смыслу', () => {
    expect(inferArtifactKind('MCP сервер для Confluence wiki.example.com')).toBe('mcp');
    expect(inferArtifactKind('stdio command npx atlassian-jira-mcp')).toBe('mcp');
    expect(inferArtifactKind('правило: всегда пиши тесты сначала')).toBe('rule');
    expect(inferArtifactKind('вспомогательная LLM для corp endpoint')).toBe('pawn');
    expect(inferArtifactKind('агент который ревьюит PR')).toBe('agent');
    expect(inferArtifactKind('workflow анализа задач и ответы в markdown')).toBe('skill');
  });

  it('пустой промпт → skill по умолчанию', () => {
    expect(inferArtifactKind('')).toBe('skill');
    expect(inferArtifactKind('   ')).toBe('skill');
  });

  it('suggestArtifactLabel и default labels', () => {
    expect(suggestArtifactLabel('MCP для Confluence', 'mcp')).toMatch(/confluence/i);
    expect(isDefaultArtifactLabel('Новая нода')).toBe(true);
    expect(isDefaultArtifactLabel('New skill')).toBe(true);
    expect(isDefaultArtifactLabel('Confluence')).toBe(false);
  });
});

describe('GraphService add node without kind menu', () => {
  it('addArtifactNode() без kind открывает чат ноды, не настройки', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const id = svc.addArtifactNode();
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('expected artifact');
    expect(node.data.label).toBe('Новая нода');
    expect(svc.settingsOpen()).toBe(false);
    expect(svc.selectedNodeId()).toBe(id);
    expect(svc.chatPromptFocusNonce()).toBeGreaterThan(0);

    svc.updateNodePrompt(id, 'нужен mcp для Confluence');
    const updated = svc.graph().nodes.find((n) => n.id === id);
    if (updated?.type !== 'artifact') throw new Error('expected artifact');
    expect(updated.data.kind).toBe('mcp');
    expect(updated.data.label).not.toBe('Новая нода');

    svc.generateArtifact(id);
    const afterGen = svc.graph().nodes.find((n) => n.id === id);
    if (afterGen?.type !== 'artifact') throw new Error('expected artifact');
    expect(afterGen.data.kind).toBe('mcp');
    expect(afterGen.data.artifactPath).toContain('mcp.d');
    expect(ARTIFACT_KIND_LABELS[afterGen.data.kind]).toBeTruthy();
  });
});
