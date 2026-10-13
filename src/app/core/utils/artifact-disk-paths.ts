import type { ArtifactNodeData } from '../models/graph.model';
import { defaultArtifactPath, relocateArtifactPath, LAYERCOOP_DIR } from './export-artifacts';

/** Относительные пути под `.layercoop/`, которые нужно снести с диска при удалении ноды. */
export function collectArtifactDiskPaths(data: ArtifactNodeData): string[] {
  if (data.kind === 'repo') return [];

  const rel = relocateArtifactPath(
    (data.artifactPath?.trim() || defaultArtifactPath(data.kind, data.label)).replace(/\\/g, '/'),
  );
  if (!rel.startsWith(`${LAYERCOOP_DIR}/`)) return [];

  const out = new Set<string>([rel]);
  // skill: каталог `.layercoop/skills/{slug}/`
  const skillDir = rel.match(/^\.layercoop\/skills\/([^/]+)\/SKILL\.md$/i);
  if (skillDir) out.add(`.layercoop/skills/${skillDir[1]}`);

  return [...out];
}
