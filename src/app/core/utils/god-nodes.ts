import {
  GOD_NODE_ID,
  defaultGodData,
  isGodData,
  normalizeGodData,
  type GodNodeData,
  type GraphNode,
  type LayercoopGraph,
} from '../models/graph.model';
import { buildAdjacency } from './graph-links';

export function isPrimaryGod(nodeId: string): boolean {
  return nodeId === GOD_NODE_ID;
}

export function listGodNodes(graph: LayercoopGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.type === 'god');
}

/** Конфиг LLM для рана: фокус-god или primary. */
export function resolveExecutor(graph: LayercoopGraph, focusNodeId: string): GodNodeData {
  const focus = graph.nodes.find((n) => n.id === focusNodeId);
  if (focus?.type === 'god' && isGodData(focus.data)) {
    return normalizeGodData(focus.data);
  }
  const primary = graph.nodes.find((n) => n.id === GOD_NODE_ID);
  return primary ? normalizeGodData(primary.data) : defaultGodData();
}

/** Саб-GOD, достижимые от primary по undirected-рёбрам. */
export function connectedSubGods(graph: LayercoopGraph): GraphNode[] {
  const adj = buildAdjacency(graph);
  const visited = new Set<string>([GOD_NODE_ID]);
  const queue = [GOD_NODE_ID];
  const subs: GraphNode[] = [];

  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
      const node = graph.nodes.find((n) => n.id === next);
      if (node?.type === 'god' && !isPrimaryGod(node.id)) {
        subs.push(node);
      }
    }
  }

  return subs.sort((a, b) => a.id.localeCompare(b.id));
}

/** Есть ли путь от primary к nodeId. */
export function isReachableFromPrimary(graph: LayercoopGraph, nodeId: string): boolean {
  if (nodeId === GOD_NODE_ID) return true;
  const adj = buildAdjacency(graph);
  const visited = new Set<string>([GOD_NODE_ID]);
  const queue = [GOD_NODE_ID];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (visited.has(next)) continue;
      if (next === nodeId) return true;
      visited.add(next);
      queue.push(next);
    }
  }
  return false;
}
