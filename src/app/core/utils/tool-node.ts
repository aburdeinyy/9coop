import {
  GOD_NODE_ID,
  isArtifactData,
  type LayercoopGraph,
} from '../models/graph.model';

const BUILTIN_TOOLS = new Set([
  'shell',
  'read',
  'write',
  'edit',
  'delete',
  'glob',
  'grep',
  'semsearch',
  'await',
  'task',
  'todowrite',
  'generateimage',
]);

/** Нода на доске, которую подсвечивать для tool-события. */
export function resolveToolNodeId(
  graph: LayercoopGraph,
  toolName: string,
  fallbackId: string,
): string {
  const raw = toolName.trim();
  if (!raw) return fallbackId;
  const name = raw.toLowerCase();

  if (BUILTIN_TOOLS.has(name)) return GOD_NODE_ID;

  const artifacts = graph.nodes.filter((n) => n.type === 'artifact' && isArtifactData(n.data));

  if (name === 'mcp' || name.startsWith('mcp')) {
    const mcp = artifacts.find(
      (n) => isArtifactData(n.data) && n.data.kind === 'mcp' && n.data.connected !== false,
    );
    if (mcp) return mcp.id;
  }

  const byLabel = artifacts.find((n) => {
    if (!isArtifactData(n.data)) return false;
    const label = n.data.label.trim().toLowerCase();
    if (!label) return false;
    return name.includes(label) || label.includes(name);
  });
  if (byLabel) return byLabel.id;

  return fallbackId;
}
