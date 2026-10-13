import type { GraphEdge, GraphNode, NodeGroup } from '../models/graph.model';
import {
  type NodeBox,
  cubicPathBetweenBoxes,
  nodeBox,
} from './edge-path';
import { groupFrameRect, groupGridCols } from './node-group';

export { cubicPathBetweenBoxes } from './edge-path';

export type GroupEdgeVisual = {
  /** Ключ для track; одна визуальная линия может покрывать несколько graph-edges. */
  key: string;
  edgeIds: string[];
  path: string;
  sourceBox: NodeBox;
  targetBox: NodeBox;
};

function groupOf(nodeId: string, groups: NodeGroup[]): NodeGroup | undefined {
  return groups.find((g) => g.memberIds.includes(nodeId));
}

/** Эндпоинт линка — внешняя рамка группы (как nodeBox у обычной ноды). */
export function groupAsBox(group: NodeGroup): NodeBox {
  const cols = groupGridCols(group.memberIds.length);
  const rect = groupFrameRect(group.position, group.memberIds.length, cols);
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/** Бокс для отрисовки линка: рамка группы или сама нода. */
export function endpointBoxForNode(
  nodeId: string,
  nodes: GraphNode[],
  groups: NodeGroup[],
): NodeBox | null {
  const g = groupOf(nodeId, groups);
  if (g) return groupAsBox(g);
  const node = nodes.find((n) => n.id === nodeId);
  return node ? nodeBox(node) : null;
}

function endpointKey(nodeId: string, groups: NodeGroup[]): string {
  return groupOf(nodeId, groups)?.id ?? nodeId;
}

/**
 * Рёбра для SVG: внешние линки цепляются к рамке группы,
 * рёбра внутри одной группы скрыты, несколько линков к одной группе — одна линия.
 */
export function buildGroupEdgeVisuals(
  edges: GraphEdge[],
  nodes: GraphNode[],
  groups: NodeGroup[],
): GroupEdgeVisual[] {
  const byPair = new Map<string, GroupEdgeVisual>();

  for (const edge of edges) {
    const srcG = groupOf(edge.source, groups);
    const tgtG = groupOf(edge.target, groups);
    if (srcG && tgtG && srcG.id === tgtG.id) continue;

    const srcKey = endpointKey(edge.source, groups);
    const tgtKey = endpointKey(edge.target, groups);
    const pair = [srcKey, tgtKey].sort().join('__');

    const sourceBox = endpointBoxForNode(edge.source, nodes, groups);
    const targetBox = endpointBoxForNode(edge.target, nodes, groups);
    if (!sourceBox || !targetBox) continue;

    const existing = byPair.get(pair);
    if (existing) {
      existing.edgeIds.push(edge.id);
      continue;
    }

    byPair.set(pair, {
      key: pair,
      edgeIds: [edge.id],
      path: cubicPathBetweenBoxes(sourceBox, targetBox),
      sourceBox,
      targetBox,
    });
  }

  return [...byPair.values()];
}
