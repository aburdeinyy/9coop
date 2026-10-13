import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, NodeGroup } from '../src/app/core/models/graph.model';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import {
  buildGroupEdgeVisuals,
  cubicPathBetweenBoxes,
  endpointBoxForNode,
  groupAsBox,
} from '../src/app/core/utils/group-edge-visual';
import { nodeBox } from '../src/app/core/utils/edge-path';

const god: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: defaultGodData(),
};

function skill(id: string, x: number, y: number): GraphNode {
  return {
    id,
    type: 'artifact',
    position: { x, y },
    data: { kind: 'skill', label: id, prompt: 'p', connected: true },
  };
}

describe('group edge visual', () => {
  it('эндпоинт ноды в группе — граница рамки', () => {
    const group: NodeGroup = {
      id: 'group-1',
      memberIds: ['a', 'b'],
      position: { x: 200, y: 100 },
    };
    const nodes = [god, skill('a', 220, 140), skill('b', 400, 140)];
    const box = endpointBoxForNode('a', nodes, [group]);
    expect(box).toEqual(groupAsBox(group));
    expect(box!.w).toBeGreaterThan(40);
    expect(box!.h).toBeGreaterThan(40);
    expect(endpointBoxForNode(GOD_NODE_ID, nodes, [group])).toEqual(nodeBox(god));
  });

  it('внешние рёбра идут к грани группы; внутренние скрыты; дубли схлопываются', () => {
    const group: NodeGroup = {
      id: 'group-1',
      memberIds: ['a', 'b'],
      position: { x: 200, y: 100 },
    };
    const nodes = [god, skill('a', 220, 140), skill('b', 400, 140)];
    const edges: GraphEdge[] = [
      { id: 'e-god-a', source: GOD_NODE_ID, target: 'a' },
      { id: 'e-god-b', source: GOD_NODE_ID, target: 'b' },
      { id: 'e-a-b', source: 'a', target: 'b' },
    ];
    const visuals = buildGroupEdgeVisuals(edges, nodes, [group]);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.edgeIds).toEqual(expect.arrayContaining(['e-god-a', 'e-god-b']));
    expect(visuals[0]!.path).toBe(
      cubicPathBetweenBoxes(nodeBox(god), groupAsBox(group)),
    );
  });
});
