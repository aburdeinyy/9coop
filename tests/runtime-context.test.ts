import { describe, expect, it } from 'vitest';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import { runRuntime } from '../src/app/core/runtime/runtime-engine';
import { reduceContextVisual } from '../src/app/core/utils/run-context-visual';

const godNode: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: defaultGodData(),
};

function skill(id: string, label: string, prompt: string, body: string): GraphNode {
  return {
    id,
    type: 'artifact',
    position: { x: 200, y: 0 },
    data: {
      kind: 'skill',
      label,
      prompt,
      connected: true,
      artifactPath: `.layercoop/skills/${id}/SKILL.md`,
      artifactContent: body,
    },
  };
}

function graph(nodes: GraphNode[], edges: LayercoopGraph['edges']): LayercoopGraph {
  return {
    version: 1,
    name: 'demo',
    updatedAt: '2026-09-03T00:00:00.000Z',
    nodes: [godNode, ...nodes],
    edges,
  };
}

describe('run context indication', () => {
  it('compose отдаёт selectedArtifactIds релевантных skill', () => {
    const g = graph(
      [
        skill('skill-jira', 'Jira Analyst', 'тикеты jira', 'FULL_JIRA'),
        skill('skill-conf', 'Confluence', 'wiki confluence', 'FULL_CONF'),
      ],
      [
        { id: 'e1', source: GOD_NODE_ID, target: 'skill-jira' },
        { id: 'e2', source: GOD_NODE_ID, target: 'skill-conf' },
      ],
    );
    const ctx = composeChatContext(g, 'разбери jira задачу');
    expect(ctx.selectedArtifactIds).toContain('skill-jira');
    expect(ctx.selectedArtifactIds).not.toContain('skill-conf');
  });

  it('runRuntime эмитит run:context с релевантными нодами и рёбрами', async () => {
    const g = graph(
      [
        skill('skill-jira', 'Jira Analyst', 'тикеты jira', 'FULL_JIRA'),
        skill('skill-conf', 'Confluence', 'wiki confluence', 'FULL_CONF'),
      ],
      [
        { id: 'e1', source: GOD_NODE_ID, target: 'skill-jira' },
        { id: 'e2', source: GOD_NODE_ID, target: 'skill-conf' },
      ],
    );

    const events = [];
    for await (const event of runRuntime(g, 'разбери jira задачу', {
      delay: async () => undefined,
      complete: async () => 'ok',
    })) {
      events.push(event);
    }

    const ctxEvent = events.find((e) => e.type === 'run:context');
    expect(ctxEvent).toMatchObject({ type: 'run:context' });
    if (ctxEvent?.type !== 'run:context') throw new Error('run:context');
    expect(ctxEvent.nodeIds).toContain('skill-jira');
    expect(ctxEvent.nodeIds).not.toContain('skill-conf');
    expect(ctxEvent.edgeIds).toContain('e1');
    expect(events[0]?.type).toBe('run:start');
    expect(events.indexOf(ctxEvent)).toBeLessThan(
      events.findIndex((e) => e.type === 'token'),
    );
  });

  it('reduceContextVisual держит context до run:end / cancel', () => {
    let state = reduceContextVisual(undefined, {
      type: 'run:context',
      nodeIds: ['skill-jira'],
      edgeIds: ['e1'],
    });
    expect(state.nodeIds.has('skill-jira')).toBe(true);
    expect(state.edgeIds.has('e1')).toBe(true);

    state = reduceContextVisual(state, { type: 'node:done', nodeId: 'skill-jira' });
    expect(state.nodeIds.has('skill-jira')).toBe(true);

    state = reduceContextVisual(state, { type: 'run:end', runId: 'r1' });
    expect(state.nodeIds.size).toBe(0);
    expect(state.edgeIds.size).toBe(0);
  });
});
