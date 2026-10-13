import { describe, expect, it, vi } from 'vitest';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';
import {
  composeChatContext,
  toUserVisibleReply,
} from '../src/app/core/utils/compose-context';
import { buildExportBundle, defaultArtifactPath, relocateArtifactPath } from '../src/app/core/utils/export-artifacts';

const godNode: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { label: 'Cursor' },
};

function makeSkillNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'skill-jira',
    type: 'artifact',
    position: { x: 200, y: 0 },
    data: {
      kind: 'skill',
      label: 'Jira Analyst',
      prompt: 'Создай skill для работы с Jira через MCP',
      artifactPath: '.layercoop/skills/jira-analyst/SKILL.md',
      artifactContent: '---\nname: jira-analyst\n---\n# Jira',
      connected: true,
    },
    ...overrides,
  };
}

describe('composeChatContext', () => {
  it('включает только ноды, соединённые с GOD-node', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode, makeSkillNode()],
      edges: [{ id: 'e1', source: GOD_NODE_ID, target: 'skill-jira' }],
    };

    const context = composeChatContext(graph, 'Проанализируй задачу MKPI-1');

    expect(context.systemPrompt).toContain('Cursor Orchestration Graph');
    expect(context.systemPrompt).toContain('только артефакты Layercoop-графа');
    expect(context.systemPrompt).toMatch(/не используй|игнорируй/i);
    expect(context.systemPrompt).toMatch(/только ответ|не раскрывай|не повторяй/i);
    expect(context.systemPrompt).toMatch(/подключённ|можно перечислять|layercoop-граф/i);
    expect(context.connectedArtifacts).toHaveLength(1);
    expect(context.connectedArtifacts[0].label).toBe('Jira Analyst');
    expect(context.userPrompt).toBe('Проанализируй задачу MKPI-1');
  });

  it('toUserVisibleReply убирает служебный статус/эхо инструкций', () => {
    const leaked = [
      '**GOD-node активен.** Проверка пройдена.',
      '',
      '| Параметр | Статус |',
      '|---|---|',
      '| Провайдер | Cursor (local) (`composer-2.5`) |',
      '| Роль | GOD-node (Layercoop) |',
      '',
      'Готов принимать задачи.',
      '',
      '---',
      '',
      'Вот ответ пользователю: сделай так.',
    ].join('\n');

    expect(toUserVisibleReply(leaked)).toBe('Вот ответ пользователю: сделай так.');
    expect(toUserVisibleReply('Просто ответ')).toBe('Просто ответ');
  });

  it('toUserVisibleReply не вырезает таблицу со списком MCP из ответа', () => {
    const answer = [
      '**Подключённые MCP в графе Layercoop:**',
      '',
      '| MCP | Статус |',
      '|---|---|',
      '| JIRA | подключён |',
      '',
      'Других MCP-нод в графе нет.',
    ].join('\n');

    expect(toUserVisibleReply(answer)).toContain('| JIRA | подключён |');
    expect(toUserVisibleReply(answer)).toContain('Подключённые MCP');
  });

  it('toUserVisibleReply не вырезает маркированный список MCP', () => {
    const answer = [
      'Подключённые MCP:',
      '- JIRA (`mcp`) — connected',
      '',
      'Других MCP-нод нет.',
    ].join('\n');

    expect(toUserVisibleReply(answer)).toContain('JIRA');
    expect(toUserVisibleReply(answer)).toContain('connected');
  });

  it('при пустом графе явно запрещает ambient MCP/skills Cursor', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode],
      edges: [],
    };
    const context = composeChatContext(graph, 'ping');
    expect(context.systemPrompt).toContain('(нет подключённых нод)');
    expect(context.systemPrompt).toMatch(/игнорируй|не вызывай/i);
    expect(context.systemPrompt).toContain('.layercoop/');
    expect(context.systemPrompt).toMatch(/ЗАПРЕЩЕНО писать в `\.cursor\//);
  });

  it('focusNodeId и chatHistory попадают в system prompt', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode, makeSkillNode()],
      edges: [{ id: 'e1', source: GOD_NODE_ID, target: 'skill-jira' }],
    };
    const context = composeChatContext(graph, 'next', {
      focusNodeId: 'skill-jira',
      chatHistory: [
        { id: '1', role: 'user', content: 'prev-q', timestamp: '2026-09-03T12:00:00.000Z' },
        { id: '2', role: 'assistant', content: 'prev-a', timestamp: '2026-09-03T12:00:01.000Z' },
      ],
    });
    expect(context.focusNodeId).toBe('skill-jira');
    expect(context.systemPrompt).toContain('← focus');
    expect(context.systemPrompt).toContain('prev-q');
    expect(context.systemPrompt).toContain('prev-a');
  });

  it('игнорирует ноды без связи с GOD-node', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode, makeSkillNode({ id: 'orphan' })],
      edges: [],
    };

    const context = composeChatContext(graph, 'hello');
    expect(context.connectedArtifacts).toHaveLength(0);
  });
});

describe('exportArtifacts', () => {
  it('генерирует git-friendly пути для skill/mcp/agent/rule', () => {
    expect(defaultArtifactPath('skill', 'My Skill')).toBe('.layercoop/skills/my-skill/SKILL.md');
    expect(defaultArtifactPath('mcp', 'GitHub Tools')).toBe('.layercoop/mcp.d/github-tools.json');
    expect(defaultArtifactPath('agent', 'Reviewer')).toBe('.layercoop/agents/reviewer.md');
    expect(defaultArtifactPath('rule', 'TDD Rule')).toBe('.layercoop/rules/tdd-rule.mdc');
  });

  it('собирает bundle: graph.json + артефакты + README', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode, makeSkillNode()],
      edges: [{ id: 'e1', source: GOD_NODE_ID, target: 'skill-jira' }],
    };

    const bundle = buildExportBundle(graph);

    expect(bundle.files.some((f) => f.path === '.layercoop/graph.json')).toBe(true);
    expect(bundle.files.some((f) => f.path === '.layercoop/skills/jira-analyst/SKILL.md')).toBe(true);
    expect(bundle.files.some((f) => f.path === '.layercoop/README.md')).toBe(true);
    expect(bundle.mcpMergePatch).toBeUndefined();
  });

  it('relocateArtifactPath мигрирует .cursor → .layercoop', () => {
    expect(relocateArtifactPath('.cursor/skills/x/SKILL.md')).toBe('.layercoop/skills/x/SKILL.md');
    expect(relocateArtifactPath('layercoop.graph.json')).toBe('.layercoop/graph.json');
    expect(relocateArtifactPath('.layercoop/agents/a.md')).toBe('.layercoop/agents/a.md');
  });

  it('добавляет mcpMergePatch для MCP-нод', () => {
    const mcpNode: GraphNode = {
      id: 'mcp-github',
      type: 'artifact',
      position: { x: 200, y: 100 },
      data: {
        kind: 'mcp',
        label: 'GitHub Tools',
        prompt: 'MCP для GitHub',
        artifactPath: '.layercoop/mcp.d/github-tools.json',
        artifactContent: JSON.stringify({
          mcpServers: { github: { command: 'npx', args: ['github-mcp'] } },
        }),
        connected: true,
      },
    };

    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode, mcpNode],
      edges: [],
    };

    const bundle = buildExportBundle(graph);
    expect(bundle.mcpMergePatch).toBeDefined();
    expect(bundle.files.some((f) => f.path === '.layercoop/mcp.json')).toBe(true);
  });
});

describe('GraphService.updateNodePosition', () => {
  it('двигает GOD-ноду и сохраняет type === god', () => {
    const service = new GraphService();
    service.updateNodePosition(GOD_NODE_ID, { x: 400, y: 250 });

    const god = service.graph().nodes.find((n) => n.id === GOD_NODE_ID);
    expect(god).toBeDefined();
    expect(god?.type).toBe('god');
    expect(god?.position).toEqual({ x: 400, y: 250 });
  });

  it('двигает artifact-ноду после addArtifactNode', () => {
    const service = new GraphService();
    const id = service.addArtifactNode('skill');
    service.updateNodePosition(id, { x: 10, y: 20 });

    const node = service.graph().nodes.find((n) => n.id === id);
    expect(node?.position).toEqual({ x: 10, y: 20 });
  });
});

describe('GraphService.removeArtifactNode', () => {
  it('удаляет ноду, edges и чат; GOD не удаляется', () => {
    const service = new GraphService();
    const id = service.addArtifactNode('mcp');
    service.connectToGod(id);
    service.pushChatMessage(id, {
      id: 'm1',
      role: 'user',
      content: 'hi',
      timestamp: new Date().toISOString(),
    });
    expect(service.isConnected(id)).toBe(true);

    service.removeArtifactNode(GOD_NODE_ID);
    expect(service.graph().nodes.some((n) => n.id === GOD_NODE_ID)).toBe(true);

    service.openSettings(id);
    service.removeArtifactNode(id);

    expect(service.graph().nodes.some((n) => n.id === id)).toBe(false);
    expect(service.graph().edges.some((e) => e.source === id || e.target === id)).toBe(false);
    expect(service.chatMessagesFor(id)).toEqual([]);
    expect(service.selectedNodeId()).toBeNull();
    expect(service.settingsOpen()).toBe(false);
  });

  it('при удалении дергает cleanup дисковых артефактов', async () => {
    const deleted: unknown[] = [];
    const disk = {
      deleteForArtifact: async (data: unknown) => {
        deleted.push(data);
      },
    };
    const service = new GraphService(undefined, disk as never);
    const id = service.addArtifactNode('skill');
    service.updateNodePrompt(id, 'ponytail skill раз в 5 минут');
    service.removeArtifactNode(id);
    await Promise.resolve();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ kind: 'skill' });
  });
});

describe('GraphService settings bubble', () => {
  it('openSettings открывает bubble, dismissSettings прячет без снятия selection', () => {
    const service = new GraphService();
    const id = service.addArtifactNode('skill');
    expect(service.selectedNodeId()).toBe(id);
    expect(service.settingsOpen()).toBe(false);

    service.openSettings(id);
    expect(service.settingsOpen()).toBe(true);
    expect(service.selectedNodeId()).toBe(id);

    service.dismissSettings();
    expect(service.settingsOpen()).toBe(false);
    expect(service.selectedNodeId()).toBe(id);

    service.selectNode(id);
    expect(service.settingsOpen()).toBe(false);
  });
});

describe('GraphService connect/disconnect', () => {
  it('disconnectFromGod снимает edge и connected', () => {
    const service = new GraphService();
    const id = service.addArtifactNode('skill');
    service.connectToGod(id);
    expect(service.isConnected(id)).toBe(true);

    service.disconnectFromGod(id);
    expect(service.isConnected(id)).toBe(false);
    const node = service.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type === 'artifact') {
      expect((node.data as { connected: boolean }).connected).toBe(false);
    }
    expect(service.graph().edges.some((e) => e.target === id || e.source === id)).toBe(false);
  });

  it('connectToGod запускает linking-пульс на edge и нодах', () => {
    vi.useFakeTimers();
    const service = new GraphService();
    const id = service.addArtifactNode('skill');
    const edgeId = [GOD_NODE_ID, id].sort().join('__');
    const fullEdgeId = `edge-${edgeId}`;

    service.connectToGod(id);
    expect(service.isEdgeConnecting(fullEdgeId)).toBe(true);
    expect(service.isNodeLinking(GOD_NODE_ID)).toBe(true);
    expect(service.isNodeLinking(id)).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(service.isEdgeConnecting(fullEdgeId)).toBe(false);
    expect(service.isNodeLinking(id)).toBe(false);
    vi.useRealTimers();
  });

  it('повторный connectToGod не перезапускает пульс', () => {
    vi.useFakeTimers();
    const service = new GraphService();
    const id = service.addArtifactNode('skill');
    const fullEdgeId = `edge-${[GOD_NODE_ID, id].sort().join('__')}`;
    service.connectToGod(id);
    vi.advanceTimersByTime(1500);
    expect(service.isEdgeConnecting(fullEdgeId)).toBe(false);

    service.connectToGod(id);
    expect(service.isEdgeConnecting(fullEdgeId)).toBe(false);
    vi.useRealTimers();
  });
});
