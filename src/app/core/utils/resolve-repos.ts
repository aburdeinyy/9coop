import { isArtifactData, type LayercoopGraph } from '../models/graph.model';
import { getConnectedArtifactIds } from './graph-links';

export type ConnectedRepo = {
  id: string;
  label: string;
  path: string;
};

export type ResolvedRepos = {
  /** cwd для Agent — первая связанная repo по id */
  cwd: string | undefined;
  /** все связанные пути (включая cwd) */
  paths: string[];
  nodes: ConnectedRepo[];
};

/** Repo-ноды, связанные с primary GOD, со стабильным порядком по id. */
export function resolveConnectedRepos(graph: LayercoopGraph): ResolvedRepos {
  const connected = getConnectedArtifactIds(graph);
  const nodes: ConnectedRepo[] = graph.nodes
    .filter(
      (n) =>
        n.type === 'artifact' &&
        connected.has(n.id) &&
        isArtifactData(n.data) &&
        n.data.kind === 'repo',
    )
    .map((n) => {
      const path = isArtifactData(n.data) ? n.data.repoPath?.trim() ?? '' : '';
      const label = isArtifactData(n.data) ? n.data.label : n.id;
      return { id: n.id, label, path };
    })
    .filter((n) => n.path.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    cwd: nodes[0]?.path,
    paths: nodes.map((n) => n.path),
    nodes,
  };
}

export function formatWorkspacesPromptBlock(resolved: ResolvedRepos): string {
  if (!resolved.nodes.length) return '';
  const lines = [
    'Workspaces (локальные git-репозитории для ЧТЕНИЯ кода, связанные с primary GOD):',
    '- Это НЕ cwd записи артефактов. Куда писать `.layercoop/` — только блок «Место сохранения» / saveTarget.',
  ];
  for (const n of resolved.nodes) {
    lines.push(`- ${n.label}: ${n.path}`);
  }
  lines.push(
    'Правки кода продукта — по абсолютному пути в нужном репозитории. Файлы skill/mcp/agent/rule — только в cwd записи из saveTarget.',
  );
  return lines.join('\n');
}
