import { describe, expect, it, vi } from 'vitest';
import type { GraphNode, LayercoopGraph } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';
import {
  composeChatContext,
  getConnectedArtifactIds,
} from '../src/app/core/utils/compose-context';
import { connectionStatusLabel, listConnectedArtifacts } from '../src/app/core/utils/graph-links';
import { buildRuntimePlan } from '../src/app/core/runtime/runtime-plan';

function god(): GraphNode {
  return {
    id: GOD_NODE_ID,
    type: 'god',
    position: { x: 0, y: 0 },
    data: { label: 'Cursor' },
  };
}

function artifact(
  id: string,
  label: string,
  connected = false,
): GraphNode {
  return {
    id,
    type: 'artifact',
    position: { x: 100, y: 0 },
    data: {
      kind: 'skill',
      label,
      prompt: `prompt ${label}`,
      artifactContent: `content ${label}`,
      connected,
    },
  };
}

describe('graph chains', () => {
  it('getConnectedArtifactIds включает всю цепочку от GOD', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'chain',
      updatedAt: '2026-09-04T00:00:00.000Z',
      nodes: [god(), artifact('a', 'A'), artifact('b', 'B'), artifact('c', 'C'), artifact('orphan', 'Orphan')],
      edges: [
        { id: 'e-god-a', source: GOD_NODE_ID, target: 'a' },
        { id: 'e-a-b', source: 'a', target: 'b' },
        { id: 'e-b-c', source: 'b', target: 'c' },
      ],
    };

    const ids = getConnectedArtifactIds(graph);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    expect(ids.has('orphan')).toBe(false);
  });

  it('listConnectedArtifacts показывает skill/mcp из цепочки, не только MCP JSON', () => {
    const mcp: GraphNode = {
      id: 'mcp-1',
      type: 'artifact',
      position: { x: 200, y: 0 },
      data: {
        kind: 'mcp',
        label: 'GitLab MCP',
        prompt: 'mcp',
        artifactContent: JSON.stringify({ mcpServers: { gitlab: { command: 'npx' } } }),
        connected: false,
      },
    };
    const graph: LayercoopGraph = {
      version: 1,
      name: 'chain',
      updatedAt: '2026-09-04T00:00:00.000Z',
      nodes: [god(), artifact('skill-1', 'GitLab skill'), mcp, artifact('orphan', 'Orphan')],
      edges: [
        { id: 'e-god-skill', source: GOD_NODE_ID, target: 'skill-1' },
        { id: 'e-god-mcp', source: GOD_NODE_ID, target: 'mcp-1' },
      ],
    };

    const listed = listConnectedArtifacts(graph);
    expect(listed.map((n) => n.label)).toEqual(['GitLab MCP', 'GitLab skill']);
    expect(listed.find((n) => n.id === 'skill-1')).toMatchObject({ kind: 'skill', label: 'GitLab skill' });
    expect(listed.some((n) => n.id === 'orphan')).toBe(false);
  });

  it('composeChatContext подтягивает артефакты из цепочки', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'chain',
      updatedAt: '2026-09-04T00:00:00.000Z',
      nodes: [god(), artifact('a', 'Alpha'), artifact('b', 'Beta')],
      edges: [
        { id: 'e1', source: GOD_NODE_ID, target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
      ],
    };

    const ctx = composeChatContext(graph, 'ping');
    expect(ctx.connectedArtifacts.map((x) => x.label).sort()).toEqual(['Alpha', 'Beta']);
    expect(ctx.systemPrompt).toContain('Alpha');
    expect(ctx.systemPrompt).toContain('Beta');
    expect(ctx.systemPrompt).toContain('content Beta');
  });

  it('GraphService.linkNodes: artifact↔artifact + connected по reachability', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const a = svc.addArtifactNode('skill');
    const b = svc.addArtifactNode('mcp');
    const c = svc.addArtifactNode('agent');

    svc.linkNodes(GOD_NODE_ID, a);
    svc.linkNodes(a, b);
    svc.linkNodes(b, c);

    expect(svc.isConnected(a)).toBe(true);
    expect(svc.isConnected(b)).toBe(true);
    expect(svc.isConnected(c)).toBe(true);
    expect(svc.connectedCount()).toBe(3);

    const ids = getConnectedArtifactIds(svc.graph());
    expect(ids.has(a) && ids.has(b) && ids.has(c)).toBe(true);

    svc.unlinkNodes(a, b);
    expect(svc.isConnected(a)).toBe(true);
    expect(svc.isConnected(b)).toBe(false);
    expect(svc.isConnected(c)).toBe(false);
  });

  it('link mode: beginLink → completeLink', () => {
    const svc = new GraphService();
    const a = svc.addArtifactNode('skill');
    const b = svc.addArtifactNode('skill');
    svc.connectToGod(a);

    svc.beginLink(a);
    expect(svc.linkingFromId()).toBe(a);
    svc.completeLink(b);
    expect(svc.linkingFromId()).toBeNull();
    expect(svc.isLinked(a, b)).toBe(true);
    expect(svc.isConnected(b)).toBe(true);
  });

  it('buildRuntimePlan включает ноды цепочки и edge не только к GOD', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'chain',
      updatedAt: '2026-09-04T00:00:00.000Z',
      nodes: [god(), artifact('a', 'A', true), artifact('b', 'B', true)],
      edges: [
        { id: 'e-god-a', source: GOD_NODE_ID, target: 'a' },
        { id: 'e-a-b', source: 'a', target: 'b' },
      ],
    };
    const plan = buildRuntimePlan(graph);
    const ids = plan.map((s) => s.nodeId);
    expect(ids).toContain(GOD_NODE_ID);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    const stepB = plan.find((s) => s.nodeId === 'b');
    expect(stepB?.edgeId).toBe('e-a-b');
  });

  it('toggleLink связывает и отвязывает', () => {
    const svc = new GraphService();
    const a = svc.addArtifactNode('skill');
    const b = svc.addArtifactNode('skill');
    svc.toggleLink(a, b);
    expect(svc.isLinked(a, b)).toBe(true);
    svc.toggleLink(a, b);
    expect(svc.isLinked(a, b)).toBe(false);
  });

  it('нельзя связать ноду с собой; дубликат edge игнор', () => {
    vi.useFakeTimers();
    const svc = new GraphService();
    const a = svc.addArtifactNode('skill');
    svc.linkNodes(a, a);
    expect(svc.graph().edges).toHaveLength(0);

    svc.linkNodes(GOD_NODE_ID, a);
    const n = svc.graph().edges.length;
    svc.linkNodes(a, GOD_NODE_ID);
    expect(svc.graph().edges).toHaveLength(n);
    vi.useRealTimers();
  });
});

describe('connectionStatusLabel', () => {
  it('отличает пустой граф от нод без связей', () => {
    expect(connectionStatusLabel(0, 0)).toBe('нет нод');
    expect(connectionStatusLabel(2, 0)).toBe('без связей');
    expect(connectionStatusLabel(2, 1)).toBe('1 подключено');
  });
});
