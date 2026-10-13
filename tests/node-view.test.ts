import { describe, expect, it } from 'vitest';
import {
  compactPreviewLimit,
  extractLayercoopView,
  extractLayercoopViewFence,
  materializeViewFenceForChat,
  parseViewSpec,
  sanitizeViewHref,
  stripLayercoopViewFence,
  toggleChecklistItem,
  appendChecklistItem,
  removeChecklistItem,
  viewPreviewItems,
  wantsNodeView,
} from '../src/app/core/utils/node-view';
import { VIEW_PREVIEW_LIMIT } from '../src/app/core/models/node-view.model';
import { GraphService } from '../src/app/core/services/graph.service';
import { GOD_NODE_ID, normalizeArtifactData } from '../src/app/core/models/graph.model';
import { ARTIFACT_GENERATION_GUIDE } from '../src/app/core/utils/layercoop-architecture';

describe('node-view', () => {
  it('sanitizeViewHref пропускает только http(s)', () => {
    expect(sanitizeViewHref('https://jira.example/browse/X-1')).toContain('https://');
    expect(sanitizeViewHref('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeViewHref('data:text/html,hi')).toBeUndefined();
    expect(sanitizeViewHref('/relative')).toBeUndefined();
  });

  it('parseViewSpec list + отсев плохих href', () => {
    const spec = parseViewSpec({
      type: 'list',
      title: 'Задачи',
      items: [
        { text: 'A', href: 'https://ok.example/a' },
        { text: 'B', href: 'javascript:evil' },
        { text: '' },
      ],
    });
    expect(spec).toEqual({
      type: 'list',
      title: 'Задачи',
      items: [
        { text: 'A', href: 'https://ok.example/a' },
        { text: 'B' },
      ],
    });
  });

  it('parseViewSpec и preview отбрасывают строку pipeline #N', () => {
    const spec = parseViewSpec({
      type: 'list',
      items: [
        { text: 'pipeline #216623', href: 'https://gitlab.example/pipelines/216623', meta: 'failed' },
        { text: 'lint', href: 'https://gitlab.example/jobs/1', meta: 'failed' },
      ],
    });
    expect(spec).toEqual({
      type: 'list',
      items: [{ text: 'lint', href: 'https://gitlab.example/jobs/1', meta: 'failed' }],
    });
    expect(
      viewPreviewItems({
        type: 'list',
        items: [
          { text: 'pipeline #1', meta: 'failed' },
          { text: 'lint', meta: 'success' },
        ],
      }).lines.map((l) => l.text),
    ).toEqual(['lint']);
  });

  it('extractLayercoopView из fence', () => {
    const reply = [
      'Вот список:',
      '```layercoop-view',
      JSON.stringify({
        type: 'list',
        title: '10 задач',
        items: Array.from({ length: 10 }, (_, i) => ({
          text: `Task ${i + 1}`,
          href: `https://jira.example/${i + 1}`,
        })),
      }),
      '```',
      'Готово.',
    ].join('\n');

    const view = extractLayercoopView(reply);
    expect(view?.type).toBe('list');
    if (view?.type !== 'list') throw new Error('expected list');
    expect(view.items).toHaveLength(10);
    expect(extractLayercoopViewFence(reply)?.spawn).toBe(false);

    const preview = viewPreviewItems(view);
    expect(preview.lines).toHaveLength(VIEW_PREVIEW_LIMIT);
    expect(preview.more).toBe(7);

    expect(viewPreviewItems(view, 8).lines).toHaveLength(8);
    expect(viewPreviewItems(view, 8).more).toBe(2);
    expect(viewPreviewItems(view, 20).more).toBe(0);

    // Высокая плитка → больше строк в compact
    expect(compactPreviewLimit(128, { hasTitle: true, totalItems: 10 })).toBeGreaterThanOrEqual(3);
    expect(compactPreviewLimit(280, { hasTitle: true, totalItems: 10 })).toBeGreaterThanOrEqual(8);
    expect(compactPreviewLimit(280, { hasTitle: true, totalItems: 10 })).toBeGreaterThan(
      compactPreviewLimit(128, { hasTitle: true, totalItems: 10 }),
    );
    // шапки kind больше нет — в типичную плитку влезает пачка строк, не 2–3
    expect(compactPreviewLimit(160, { hasTitle: false, totalItems: 20 })).toBeGreaterThanOrEqual(6);

    expect(stripLayercoopViewFence(reply)).not.toContain('layercoop-view');
    expect(stripLayercoopViewFence(reply)).toContain('Вот список');
  });

  it('materializeViewFenceForChat оставляет список в тексте', () => {
    const reply = [
      'Открытые задачи:',
      '```layercoop-view',
      JSON.stringify({
        type: 'list',
        title: 'Jira',
        items: [{ text: 'A-1' }, { text: 'A-2' }],
      }),
      '```',
      'Готово.',
    ].join('\n');
    const out = materializeViewFenceForChat(reply);
    expect(out).toContain('A-1');
    expect(out).toContain('A-2');
    expect(out).toContain('**Jira**');
    expect(out).not.toContain('layercoop-view');
    expect(out).toContain('Готово.');
  });

  it('битый JSON → null', () => {
    expect(extractLayercoopView('```layercoop-view\n{not json}\n```')).toBeNull();
    expect(parseViewSpec({ type: 'list', items: [] })).toBeNull();
  });

  it('wantsNodeView', () => {
    expect(wantsNodeView('покажи 10 задач списком')).toBe(true);
    expect(wantsNodeView('создай чеклист релиза')).toBe(true);
    expect(wantsNodeView('checklist for deploy')).toBe(true);
    expect(wantsNodeView('подключи mcp confluence')).toBe(false);
  });

  it('parseViewSpec checklist: id, checked, уникальные id', () => {
    const spec = parseViewSpec({
      type: 'checklist',
      title: 'Релиз',
      items: [
        { text: 'Тесты', checked: true },
        { id: 'pr', text: 'Открыть PR' },
        { id: 'pr', text: 'Дубль id' },
        { text: '' },
      ],
    });
    expect(spec).toEqual({
      type: 'checklist',
      title: 'Релиз',
      items: [
        { id: 'c1', text: 'Тесты', checked: true },
        { id: 'pr', text: 'Открыть PR', checked: false },
        { id: 'pr-2', text: 'Дубль id', checked: false },
      ],
    });
  });

  it('toggleChecklistItem переключает только нужный пункт', () => {
    const view = parseViewSpec({
      type: 'checklist',
      items: [
        { id: 'a', text: 'A', checked: false },
        { id: 'b', text: 'B', checked: true },
      ],
    });
    expect(view?.type).toBe('checklist');
    if (view?.type !== 'checklist') throw new Error('expected checklist');

    const next = toggleChecklistItem(view, 'a');
    expect(next).toEqual({
      type: 'checklist',
      items: [
        { id: 'a', text: 'A', checked: true },
        { id: 'b', text: 'B', checked: true },
      ],
    });
    expect(toggleChecklistItem(view, 'missing')).toBe(view);
    expect(toggleChecklistItem({ type: 'list', items: [{ text: 'x' }] }, 'a')).toEqual({
      type: 'list',
      items: [{ text: 'x' }],
    });
  });

  it('parseViewSpec checklist пустой — валидный режим отображения', () => {
    expect(parseViewSpec({ type: 'checklist', items: [] })).toEqual({
      type: 'checklist',
      items: [],
    });
    expect(parseViewSpec({ type: 'checklist', title: 'Релиз', items: [] })).toEqual({
      type: 'checklist',
      title: 'Релиз',
      items: [],
    });
  });

  it('appendChecklistItem создаёт чеклист и добавляет пункт', () => {
    expect(appendChecklistItem(null, '  ')).toBeNull();
    const created = appendChecklistItem(null, '  Тесты  ');
    expect(created).toEqual({
      type: 'checklist',
      items: [{ id: 'c1', text: 'Тесты', checked: false }],
    });

    const view = parseViewSpec({
      type: 'checklist',
      title: 'Релиз',
      items: [{ id: 'tests', text: 'Тесты' }],
    });
    expect(view?.type).toBe('checklist');
    if (view?.type !== 'checklist') throw new Error('expected checklist');
    const next = appendChecklistItem(view, 'Открыть PR');
    expect(next).toEqual({
      type: 'checklist',
      title: 'Релиз',
      items: [
        { id: 'tests', text: 'Тесты', checked: false },
        { id: 'c2', text: 'Открыть PR', checked: false },
      ],
    });
    expect(appendChecklistItem(view, '')).toBe(view);
    expect(appendChecklistItem({ type: 'list', items: [{ text: 'x' }] }, 'nope')).toEqual({
      type: 'list',
      items: [{ text: 'x' }],
    });
  });

  it('removeChecklistItem убирает пункт, последний оставляет пустой чеклист', () => {
    const view = parseViewSpec({
      type: 'checklist',
      items: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    });
    expect(view?.type).toBe('checklist');
    if (view?.type !== 'checklist') throw new Error('expected checklist');
    const one = removeChecklistItem(view, 'a');
    expect(one).toEqual({
      type: 'checklist',
      items: [{ id: 'b', text: 'B', checked: false }],
    });
    expect(removeChecklistItem(one!, 'b')).toEqual({ type: 'checklist', items: [] });
    expect(removeChecklistItem(view, 'missing')).toBe(view);
  });

  it('extractLayercoopView checklist + preview', () => {
    const reply = [
      'Чеклист:',
      '```layercoop-view',
      JSON.stringify({
        type: 'checklist',
        title: 'Deploy',
        items: [
          { id: 'build', text: 'Собрать', checked: true },
          { text: 'Задеплоить', href: 'https://ci.example/job' },
        ],
      }),
      '```',
    ].join('\n');
    const view = extractLayercoopView(reply);
    expect(view?.type).toBe('checklist');
    if (view?.type !== 'checklist') throw new Error('expected checklist');
    expect(view.items[0]).toMatchObject({ id: 'build', checked: true });
    expect(view.items[1]).toMatchObject({
      id: 'c2',
      text: 'Задеплоить',
      checked: false,
      href: 'https://ci.example/job',
    });
    const preview = viewPreviewItems(view);
    expect(preview.lines[0]?.checked).toBe(true);
    expect(preview.lines[0]?.id).toBe('build');
  });

  it('architecture guide требует layercoop-view для плиток', () => {
    expect(ARTIFACT_GENERATION_GUIDE).toContain('layercoop-view');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('"type": "list"');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('"type": "checklist"');
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/spawn["\s:]*true|spawn.*true/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/pipeline|15\s*сек/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/Approval|approvals?/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/иконк/i);
  });

  it('viewPreviewItems прокидывает meta для иконок статуса', () => {
    const preview = viewPreviewItems({
      type: 'list',
      title: 'MR',
      items: [
        { text: 'Approval', meta: 'unapproved' },
        { text: 'lint', meta: 'success' },
      ],
    });
    expect(preview.lines[0]?.meta).toBe('unapproved');
    expect(preview.lines[1]?.meta).toBe('success');
  });

  it('GraphService setNodeView / clear + generate demo view', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const id = svc.addArtifactNode('skill');
    svc.setNodeView(id, {
      type: 'list',
      title: 'T',
      items: [{ text: 'A', href: 'https://ex.com/a' }],
    });
    let node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view?.type).toBe('list');

    svc.clearNodeView(id);
    node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view).toBeUndefined();

    svc.updateNodePrompt(id, 'покажи плитку задач');
    svc.generateArtifact(id);
    node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view?.type).toBe('list');

    svc.clearNodeView(id);
    svc.updateNodePrompt(id, 'создай чеклист релиза');
    svc.generateArtifact(id);
    node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view?.type).toBe('checklist');
    if (node.data.view?.type !== 'checklist') throw new Error('checklist');
    svc.toggleChecklistItem(id, node.data.view.items[0]!.id);
    node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact' || node.data.view?.type !== 'checklist') {
      throw new Error('checklist');
    }
    expect(node.data.view.items[0]?.checked).toBe(true);

    svc.addChecklistItem(id, 'Ручной пункт');
    node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact' || node.data.view?.type !== 'checklist') {
      throw new Error('checklist');
    }
    expect(node.data.view.items.map((i) => i.text)).toContain('Ручной пункт');
    const lastId = node.data.view.items.at(-1)!.id;
    svc.removeChecklistItem(id, lastId);
    node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact' || node.data.view?.type !== 'checklist') {
      throw new Error('checklist');
    }
    expect(node.data.view.items.map((i) => i.text)).not.toContain('Ручной пункт');

    const normalized = normalizeArtifactData(node.data);
    expect(normalized.view?.type).toBe('checklist');
  });

  it('apply view from assistant reply на artifact (как RuntimeService)', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const graph = new GraphService(storage);
    const id = graph.addArtifactNode('skill');
    const assistantId = 'a1';
    const content = [
      'Список:',
      '```layercoop-view',
      '{"type":"list","items":[{"text":"T1","href":"https://x/1"}]}',
      '```',
    ].join('\n');
    graph.pushChatMessage(id, {
      id: assistantId,
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
    });

    const view = extractLayercoopView(content);
    expect(view).not.toBeNull();
    graph.setNodeView(id, view!);
    graph.replaceChatContent(id, assistantId, stripLayercoopViewFence(content));

    const node = graph.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view?.type).toBe('list');
    expect(graph.chatMessagesFor(id).find((m) => m.id === assistantId)?.content).not.toContain(
      'layercoop-view',
    );
  });

  it('addChecklistNode включает пустой чеклист как отображение ноды', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const id = svc.addChecklistNode();
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view).toEqual({ type: 'checklist', items: [] });
    expect(node.data.label).toBe('Чеклист');
  });

  it('applyAssistantArtifacts: чеклист в чате GOD создаёт ноду на доске', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const view = parseViewSpec({
      type: 'checklist',
      title: 'Релиз',
      items: [{ text: 'Тесты' }],
    });
    expect(view?.type).toBe('checklist');
    const id = svc.applyAssistantArtifacts(GOD_NODE_ID, null, view);
    expect(id).toBeTruthy();
    expect(id).not.toBe(GOD_NODE_ID);
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view?.type).toBe('checklist');
    if (node.data.view?.type !== 'checklist') throw new Error('checklist');
    expect(node.data.view.items.map((i) => i.text)).toEqual(['Тесты']);
    expect(svc.isConnected(id!)).toBe(true);
  });

  it('applyAssistantArtifacts: list в чате GOD без spawn не создаёт плитку', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const before = svc.graph().nodes.length;
    const view = parseViewSpec({
      type: 'list',
      title: 'Открытые Jira',
      items: [{ text: 'MKPI-1' }, { text: 'MKPI-2' }],
    });
    expect(view?.type).toBe('list');
    expect(svc.applyAssistantArtifacts(GOD_NODE_ID, null, view)).toBeNull();
    expect(svc.graph().nodes.length).toBe(before);
  });

  it('extractLayercoopViewFence читает spawn:true', () => {
    const reply = [
      '```layercoop-view',
      JSON.stringify({
        type: 'list',
        spawn: true,
        title: 'MR !1 pipeline',
        items: [{ text: 'build', meta: 'running' }],
      }),
      '```',
    ].join('\n');
    const extracted = extractLayercoopViewFence(reply);
    expect(extracted?.spawn).toBe(true);
    expect(extracted?.view.type).toBe('list');
  });

  it('applyAssistantArtifacts: list + spawn с artifact создаёт новую ноду с кроном 15с', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const focus = svc.addArtifactNode('skill');
    svc.linkNodes(GOD_NODE_ID, focus);
    const mcpId = svc.addArtifactNode('mcp');
    svc.updateNodeLabel(mcpId, 'GitLab');
    svc.graph.update((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.id !== mcpId || n.type !== 'artifact') return n;
        return {
          ...n,
          data: {
            ...n.data,
            kind: 'mcp' as const,
            label: 'GitLab',
            artifactContent: JSON.stringify({
              mcpServers: { gitlab: { command: 'npx', args: ['-y', 'gitlab-mcp'] } },
            }),
          },
        };
      }),
    }));
    svc.linkNodes(GOD_NODE_ID, mcpId);

    const view = parseViewSpec({
      type: 'list',
      title: 'MR !42 pipeline',
      items: [{ text: 'build', meta: 'running', href: 'https://gitlab.example/jobs/1' }],
    });
    const before = svc.graph().nodes.length;
    const id = svc.applyAssistantArtifacts(focus, null, view, { spawn: true });
    expect(id).toBeTruthy();
    expect(id).not.toBe(focus);
    expect(svc.graph().nodes.length).toBe(before + 1);
    const node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.label).toBe('MR !42 pipeline');
    expect(node.data.view?.type).toBe('list');
    expect(node.data.autoRefresh?.intervalMs).toBe(15_000);
    expect(svc.isConnected(id!)).toBe(true);
    expect(svc.isLinked(id!, mcpId)).toBe(true);
    expect(node.data.artifactContent).toContain('layercoopRefresh');
    expect(node.data.artifactContent).toContain('gitlab');
  });

  it('applyAssistantArtifacts: view на artifact остаётся на той же ноде', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const id = svc.addArtifactNode('skill');
    const view = parseViewSpec({
      type: 'checklist',
      items: [{ text: 'A' }],
    });
    expect(svc.applyAssistantArtifacts(id, null, view)).toBe(id);
    const node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.view?.type).toBe('checklist');
  });
});
