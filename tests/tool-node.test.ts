import { describe, expect, it } from 'vitest';
import {
  GOD_NODE_ID,
  type GraphNode,
  type LayercoopGraph,
} from '../src/app/core/models/graph.model';
import { resolveToolNodeId } from '../src/app/core/utils/tool-node';

const god: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { label: 'Cursor' },
};

function graph(extra: GraphNode[]): LayercoopGraph {
  return {
    version: 1,
    name: 't',
    updatedAt: '2026-10-07T00:00:00.000Z',
    nodes: [god, ...extra],
    edges: extra.map((n) => ({
      id: `e-${n.id}`,
      source: GOD_NODE_ID,
      target: n.id,
    })),
  };
}

describe('resolveToolNodeId', () => {
  it('built-in cursor tools → GOD', () => {
    const g = graph([]);
    expect(resolveToolNodeId(g, 'shell', 'fallback')).toBe(GOD_NODE_ID);
    expect(resolveToolNodeId(g, 'read', 'fallback')).toBe(GOD_NODE_ID);
    expect(resolveToolNodeId(g, 'glob', 'fallback')).toBe(GOD_NODE_ID);
  });

  it('mcp → подключённая MCP-нода', () => {
    const g = graph([
      {
        id: 'mcp-jira',
        type: 'artifact',
        position: { x: 1, y: 0 },
        data: { kind: 'mcp', label: 'Jira', prompt: '', connected: true },
      },
    ]);
    expect(resolveToolNodeId(g, 'mcp', GOD_NODE_ID)).toBe('mcp-jira');
  });

  it('имя инструмента матчит label артефакта', () => {
    const g = graph([
      {
        id: 'mcp-gl',
        type: 'artifact',
        position: { x: 1, y: 0 },
        data: { kind: 'mcp', label: 'GitLab', prompt: '', connected: true },
      },
    ]);
    expect(resolveToolNodeId(g, 'gitlab_search', GOD_NODE_ID)).toBe('mcp-gl');
  });

  it('неизвестный tool → fallback', () => {
    expect(resolveToolNodeId(graph([]), 'custom_x', 'node-9')).toBe('node-9');
  });
});
