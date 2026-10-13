import type {
  ArtifactKind,
  ArtifactNodeData,
  GraphEdge,
  LayercoopGraph,
} from '../models/graph.model';
import { GOD_NODE_ID, isArtifactData } from '../models/graph.model';

export interface ConnectedArtifactRef {
  id: string;
  kind: ArtifactKind;
  label: string;
}

/** Стабильный id для undirected-ребра. */
export function edgeIdBetween(a: string, b: string): string {
  return `edge-${[a, b].sort().join('__')}`;
}

export function sameUndirectedEdge(
  edge: GraphEdge,
  a: string,
  b: string,
): boolean {
  return (
    (edge.source === a && edge.target === b) ||
    (edge.source === b && edge.target === a)
  );
}

export function findEdgeBetween(
  graph: LayercoopGraph,
  a: string,
  b: string,
): GraphEdge | undefined {
  return graph.edges.find((e) => sameUndirectedEdge(e, a, b));
}

/** Undirected adjacency: nodeId → соседние id. */
export function buildAdjacency(graph: LayercoopGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  for (const e of graph.edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return adj;
}

/**
 * Все artifact-ноды, достижимые от GOD по undirected-рёбрам (прямые и цепочки).
 */
export function getConnectedArtifactIds(graph: LayercoopGraph): Set<string> {
  const adj = buildAdjacency(graph);
  const visited = new Set<string>([GOD_NODE_ID]);
  const queue = [GOD_NODE_ID];
  const artifacts = new Set<string>();

  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
      const node = graph.nodes.find((n) => n.id === next);
      if (node?.type === 'artifact') artifacts.add(next);
    }
  }

  return artifacts;
}

/** Подключённые к GOD артефакты (skill, MCP, pawn…) — для панели следующего рана. */
export function listConnectedArtifacts(graph: LayercoopGraph): ConnectedArtifactRef[] {
  const ids = getConnectedArtifactIds(graph);
  const out: ConnectedArtifactRef[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'artifact' || !ids.has(node.id) || !isArtifactData(node.data)) continue;
    out.push({ id: node.id, kind: node.data.kind, label: node.data.label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** Ребро, по которому BFS от GOD впервые достиг nodeId (для flow-анимации). */
export function edgeOnPathFromGod(
  graph: LayercoopGraph,
  nodeId: string,
): string | undefined {
  if (nodeId === GOD_NODE_ID) return undefined;
  const adj = buildAdjacency(graph);
  const parentEdge = new Map<string, string>();
  const visited = new Set<string>([GOD_NODE_ID]);
  const queue = [GOD_NODE_ID];

  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const edge = findEdgeBetween(graph, cur, next);
      if (edge) parentEdge.set(next, edge.id);
      if (next === nodeId) return edge?.id;
      queue.push(next);
    }
  }

  return parentEdge.get(nodeId);
}

/** Проставляет data.connected = reachability от GOD. */
export function withSyncedConnectedFlags(graph: LayercoopGraph): LayercoopGraph {
  const connected = getConnectedArtifactIds(graph);
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== 'artifact' || !isArtifactData(node.data)) return node;
    const data = node.data as ArtifactNodeData;
    const next = connected.has(node.id);
    if (data.connected === next) return node;
    changed = true;
    return { ...node, data: { ...data, connected: next } };
  });
  return changed ? { ...graph, nodes } : graph;
}

/** Подпись бейджа чата: пустой граф, ноды без рёбер, или число связей. */
export function connectionStatusLabel(artifactCount: number, connectedCount: number): string {
  if (connectedCount > 0) return `${connectedCount} подключено`;
  if (artifactCount > 0) return 'без связей';
  return 'нет нод';
}
