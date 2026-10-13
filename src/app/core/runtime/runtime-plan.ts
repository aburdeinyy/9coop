import type { ArtifactKind, ArtifactNodeData, LayercoopGraph } from '../models/graph.model';
import { GOD_NODE_ID, isArtifactData } from '../models/graph.model';
import { edgeOnPathFromGod, getConnectedArtifactIds } from '../utils/graph-links';
import type { RuntimePlanStep } from './runtime-events';

const KIND_ORDER: ArtifactKind[] = ['rule', 'skill', 'mcp', 'agent', 'pawn'];

export function buildRuntimePlan(graph: LayercoopGraph): RuntimePlanStep[] {
  const connected = getConnectedArtifactIds(graph);
  const artifacts = graph.nodes.filter(
    (n) => n.type === 'artifact' && connected.has(n.id) && isArtifactData(n.data),
  );

  const ordered = KIND_ORDER.flatMap((kind) =>
    artifacts
      .filter((n) => (n.data as ArtifactNodeData).kind === kind)
      .map((n) => ({
        nodeId: n.id,
        kind,
        edgeId: edgeOnPathFromGod(graph, n.id),
      })),
  );

  return [{ nodeId: GOD_NODE_ID, kind: 'god' }, ...ordered];
}
