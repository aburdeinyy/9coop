import { describe, expect, it } from 'vitest';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import { buildRuntimePlan } from '../src/app/core/runtime/runtime-plan';
import { runRuntime } from '../src/app/core/runtime/runtime-engine';

const godNode: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { label: 'Cursor' },
};

function artifact(
  id: string,
  kind: 'skill' | 'mcp' | 'agent' | 'rule',
  label: string,
): GraphNode {
  return {
    id,
    type: 'artifact',
    position: { x: 200, y: 0 },
    data: { kind, label, prompt: `${label} prompt`, connected: true },
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

describe('buildRuntimePlan', () => {
  it('всегда стартует с GOD-node', () => {
    const plan = buildRuntimePlan(graph([], []));
    expect(plan).toEqual([{ nodeId: GOD_NODE_ID, kind: 'god' }]);
  });

  it('игнорирует ноды без связи с GOD-node', () => {
    const g = graph([artifact('orphan', 'skill', 'Orphan')], []);
    expect(buildRuntimePlan(g).map((s) => s.nodeId)).toEqual([GOD_NODE_ID]);
  });

  it('ставит подключённые ноды в порядке rule → skill → mcp → agent', () => {
    const nodes = [
      artifact('a-agent', 'agent', 'Reviewer'),
      artifact('a-mcp', 'mcp', 'GitHub'),
      artifact('a-skill', 'skill', 'Jira'),
      artifact('a-rule', 'rule', 'TDD'),
    ];
    const edges = nodes.map((n) => ({
      id: `edge-${n.id}`,
      source: GOD_NODE_ID,
      target: n.id,
    }));

    const plan = buildRuntimePlan(graph(nodes, edges));
    expect(plan.map((s) => s.nodeId)).toEqual([
      GOD_NODE_ID,
      'a-rule',
      'a-skill',
      'a-mcp',
      'a-agent',
    ]);
    expect(plan[1].edgeId).toBe('edge-a-rule');
    expect(plan[1].kind).toBe('rule');
  });
});

describe('runRuntime', () => {
  const noopDelay = async () => undefined;
  const complete = async () => 'llm-ok';

  it('эмитирует run:start → активации → токены → run:end', async () => {
    const g = graph(
      [artifact('a-skill', 'skill', 'Jira Analyst')],
      [{ id: 'edge-a-skill', source: GOD_NODE_ID, target: 'a-skill' }],
    );

    const events = [];
    for await (const event of runRuntime(g, 'Проанализируй MKPI-1', { delay: noopDelay, complete })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ type: 'run:start' });
    expect(events.at(-1)).toMatchObject({ type: 'run:end' });
    expect(events.some((e) => e.type === 'node:active' && e.nodeId === GOD_NODE_ID)).toBe(true);
    expect(events.some((e) => e.type === 'edge:flow' && e.edgeId === 'edge-a-skill')).toBe(true);
    expect(events.some((e) => e.type === 'node:active' && e.nodeId === 'a-skill')).toBe(true);
    expect(events.filter((e) => e.type === 'token').length).toBeGreaterThan(0);
  });

  it('для MCP эмитит tool:call, токены из complete', async () => {
    const g = graph(
      [artifact('a-mcp', 'mcp', 'GitHub Tools')],
      [{ id: 'edge-a-mcp', source: GOD_NODE_ID, target: 'a-mcp' }],
    );

    const events = [];
    for await (const event of runRuntime(g, 'list PRs', {
      delay: noopDelay,
      complete: async () => 'tool-result',
    })) {
      events.push(event);
    }

    const tool = events.find((e) => e.type === 'tool:call');
    expect(tool).toMatchObject({ type: 'tool:call', nodeId: 'a-mcp', name: 'GitHub Tools' });

    const text = events
      .filter((e) => e.type === 'token')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('tool-result');
  });
});
