import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID, isGodData } from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';
import { wantsSubGodPrompt } from '../src/app/core/utils/god-delegate';

describe('wantsSubGodPrompt', () => {
  it('ловит deepseek / саб год / подключи llm', () => {
    expect(wantsSubGodPrompt('подключи corp DeepSeek')).toBe(true);
    expect(wantsSubGodPrompt('добавь ещё одну llm')).toBe(true);
    expect(wantsSubGodPrompt('создай саб год ноду')).toBe(true);
    expect(wantsSubGodPrompt('нужен skill для jira')).toBe(false);
  });
});

describe('GraphService.applyGodSpawn', () => {
  it('из чата primary создаёт саб-GOD и линкует', () => {
    const svc = new GraphService();
    const id = svc.applyGodSpawn(GOD_NODE_ID, {
      label: 'DeepSeek',
      runner: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      linkToPrimary: true,
    });
    expect(id).toMatch(/^god-/);
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('god');
    expect(isGodData(node!.data) && node!.data.model).toBe('deepseek-chat');
    expect(svc.isLinked(GOD_NODE_ID, id!)).toBe(true);
  });

  it('готовый artifact не промоутит — создаёт отдельный саб-GOD', () => {
    const svc = new GraphService();
    const art = svc.addArtifactNode('skill');
    svc.updateNodeLabel(art, 'Jira Analyst');
    svc.updateNodePrompt(art, 'Анализ задач Jira');
    const before = svc.graph().nodes.length;
    const godId = svc.applyGodSpawn(art, {
      label: 'X',
      runner: 'openai-compatible',
      model: 'm',
      baseUrl: 'https://x/v1',
      linkToPrimary: true,
    });
    expect(godId).toMatch(/^god-/);
    expect(godId).not.toBe(art);
    expect(svc.graph().nodes.some((n) => n.id === art)).toBe(true);
    expect(svc.graph().nodes.length).toBe(before + 1);
  });
});
