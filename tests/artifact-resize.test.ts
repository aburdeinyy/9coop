import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_NODE_H,
  ARTIFACT_NODE_H_REPO,
  ARTIFACT_NODE_H_VIEW,
  ARTIFACT_NODE_W,
  ARTIFACT_NODE_W_REPO,
  clampArtifactSize,
  nodeBox,
  resolveArtifactSize,
} from '../src/app/core/utils/edge-path';
import { GraphService } from '../src/app/core/services/graph.service';
import { normalizeArtifactData } from '../src/app/core/models/graph.model';

describe('artifact tile resize', () => {
  it('clampArtifactSize ограничивает min/max', () => {
    expect(clampArtifactSize({ w: 10, h: 10 })).toEqual({ w: 120, h: 72 });
    expect(clampArtifactSize({ w: 9999, h: 9999 })).toEqual({ w: 480, h: 420 });
    expect(clampArtifactSize({ w: 200.7, h: 150.2 })).toEqual({ w: 201, h: 150 });
  });

  it('resolveArtifactSize: кастомный size или дефолт (+view)', () => {
    expect(
      resolveArtifactSize({
        kind: 'skill',
        label: 'A',
        prompt: '',
        connected: false,
      }),
    ).toEqual({ w: ARTIFACT_NODE_W, h: ARTIFACT_NODE_H });

    expect(
      resolveArtifactSize({
        kind: 'skill',
        label: 'A',
        prompt: '',
        connected: false,
        view: { type: 'list', items: [{ text: 'x' }] },
      }),
    ).toEqual({ w: ARTIFACT_NODE_W, h: ARTIFACT_NODE_H_VIEW });

    expect(
      resolveArtifactSize({
        kind: 'skill',
        label: 'A',
        prompt: '',
        connected: false,
        view: { type: 'list', items: [{ text: 'x' }] },
        size: { w: 240, h: 200 },
      }),
    ).toEqual({ w: 240, h: 200 });

    expect(
      resolveArtifactSize({
        kind: 'repo',
        label: 'Repo',
        prompt: '',
        connected: false,
        repoPath: '/tmp/x',
      }),
    ).toEqual({ w: ARTIFACT_NODE_W_REPO, h: ARTIFACT_NODE_H_REPO });
  });

  it('GraphService.setNodeSize persist + nodeBox', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    const svc = new GraphService(storage);
    const id = svc.addArtifactNode('skill');
    svc.setNodeSize(id, { w: 260, h: 180 });
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.size).toEqual({ w: 260, h: 180 });
    expect(nodeBox(node)).toMatchObject({ w: 260, h: 180 });

    const normalized = normalizeArtifactData(node.data);
    expect(normalized.size).toEqual({ w: 260, h: 180 });
  });
});
