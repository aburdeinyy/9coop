import { describe, expect, it } from 'vitest';
import type { ConnectedArtifact } from '../src/app/core/utils/compose-context';
import {
  scoreArtifact,
  selectArtifactsForPrompt,
  tokenizeForSelect,
} from '../src/app/core/utils/select-artifacts';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';

function art(
  partial: Partial<ConnectedArtifact> & Pick<ConnectedArtifact, 'id' | 'kind' | 'label'>,
): ConnectedArtifact {
  return {
    prompt: '',
    artifactContent: `FULL:${partial.id}`,
    ...partial,
  };
}

describe('selectArtifactsForPrompt', () => {
  it('tokenizeет токены длиннее 1 символа', () => {
    expect(tokenizeForSelect('Jira MKPI-1 и a')).toEqual(['jira', 'mkpi', '1']);
  });

  it('score выше при совпадении label', () => {
    const jira = art({ id: '1', kind: 'skill', label: 'Jira Analyst', prompt: 'тикеты' });
    const conf = art({ id: '2', kind: 'skill', label: 'Confluence', prompt: 'wiki' });
    const tokens = tokenizeForSelect('разбери jira тикет');
    expect(scoreArtifact(jira, tokens)).toBeGreaterThan(scoreArtifact(conf, tokens));
  });

  it('всегда включает mcp/rule и focus; top-K skills по score', () => {
    const pool = [
      art({ id: 'mcp-j', kind: 'mcp', label: 'Jira MCP', prompt: 'jira tools' }),
      art({ id: 'rule', kind: 'rule', label: 'TDD', prompt: 'тесты' }),
      art({ id: 'skill-jira', kind: 'skill', label: 'Jira Analyst', prompt: 'работа с тикетами Jira' }),
      art({
        id: 'skill-conf',
        kind: 'skill',
        label: 'Confluence Writer',
        prompt: 'страницы wiki confluence',
      }),
      art({ id: 'skill-git', kind: 'skill', label: 'GitLab MR', prompt: 'merge request gitlab' }),
      art({ id: 'focus-pawn', kind: 'pawn', label: 'Corp', prompt: 'corp llm' }),
    ];

    const selected = selectArtifactsForPrompt(pool, 'открой тикет в jira', {
      focusId: 'focus-pawn',
      limit: 1,
    });
    const ids = selected.map((a) => a.id);

    expect(ids).toContain('mcp-j');
    expect(ids).toContain('rule');
    expect(ids).toContain('focus-pawn');
    expect(ids).toContain('skill-jira');
    expect(ids).not.toContain('skill-conf');
    expect(ids).not.toContain('skill-git');
  });

  it('при нулевых score возвращает весь пул (fallback)', () => {
    const pool = [
      art({ id: 'a', kind: 'skill', label: 'Alpha', prompt: 'один' }),
      art({ id: 'b', kind: 'skill', label: 'Beta', prompt: 'два' }),
    ];
    const selected = selectArtifactsForPrompt(pool, 'zzzz unrelated', { limit: 1 });
    expect(selected.map((a) => a.id).sort()).toEqual(['a', 'b']);
  });
});

describe('composeChatContext skill select', () => {
  const godNode: GraphNode = {
    id: GOD_NODE_ID,
    type: 'god',
    position: { x: 0, y: 0 },
    data: { label: 'Cursor' },
  };

  function skill(id: string, label: string, prompt: string, content: string): GraphNode {
    return {
      id,
      type: 'artifact',
      position: { x: 1, y: 1 },
      data: {
        kind: 'skill',
        label,
        prompt,
        artifactPath: `.layercoop/skills/${id}/SKILL.md`,
        artifactContent: content,
        connected: true,
      },
    };
  }

  it('каталог все linked, полный текст — только релевантные', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [
        godNode,
        skill('skill-jira', 'Jira Analyst', 'тикеты jira', 'FULL_JIRA_BODY'),
        skill('skill-conf', 'Confluence', 'wiki confluence', 'FULL_CONF_BODY'),
      ],
      edges: [
        { id: 'e1', source: GOD_NODE_ID, target: 'skill-jira' },
        { id: 'e2', source: GOD_NODE_ID, target: 'skill-conf' },
      ],
    };

    const ctx = composeChatContext(graph, 'разбери jira задачу MKPI-1');
    expect(ctx.systemPrompt).toContain('Jira Analyst');
    expect(ctx.systemPrompt).toContain('Confluence');
    expect(ctx.systemPrompt).toContain('FULL_JIRA_BODY');
    expect(ctx.systemPrompt).not.toContain('FULL_CONF_BODY');
    expect(ctx.systemPrompt).toMatch(/релевантн|активн|загружен/i);
    expect(ctx.connectedArtifacts).toHaveLength(2);
  });
});
