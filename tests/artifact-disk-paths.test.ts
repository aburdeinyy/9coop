import { describe, expect, it } from 'vitest';
import { collectArtifactDiskPaths } from '../src/app/core/utils/artifact-disk-paths';

describe('collectArtifactDiskPaths', () => {
  it('skill → файл и каталог skills/slug', () => {
    expect(
      collectArtifactDiskPaths({
        kind: 'skill',
        label: 'Ponytail',
        prompt: 'x',
        connected: false,
        artifactPath: '.layercoop/skills/ponytail/SKILL.md',
      }),
    ).toEqual(['.layercoop/skills/ponytail/SKILL.md', '.layercoop/skills/ponytail']);
  });

  it('mcp → только json в mcp.d', () => {
    expect(
      collectArtifactDiskPaths({
        kind: 'mcp',
        label: 'GitLab',
        prompt: 'x',
        connected: false,
        artifactPath: '.layercoop/mcp.d/gitlab.json',
      }),
    ).toEqual(['.layercoop/mcp.d/gitlab.json']);
  });

  it('без path — дефолт по kind/label', () => {
    const paths = collectArtifactDiskPaths({
      kind: 'rule',
      label: 'Style Guide',
      prompt: 'x',
      connected: false,
    });
    expect(paths[0]).toMatch(/^\.layercoop\/rules\//);
  });

  it('repo — без дисковых артефактов', () => {
    expect(
      collectArtifactDiskPaths({
        kind: 'repo',
        label: 'App',
        prompt: '',
        connected: false,
        repoPath: '/tmp/x',
      }),
    ).toEqual([]);
  });
});
