import { describe, expect, it } from 'vitest';
import {
  GOD_NODE_ID,
  defaultGodData,
  type GraphNode,
  type LayercoopGraph,
} from '../src/app/core/models/graph.model';
import { resolveConnectedRepos } from '../src/app/core/utils/resolve-repos';

function graph(nodes: GraphNode[], edges: LayercoopGraph['edges']): LayercoopGraph {
  return {
    version: 1,
    name: 't',
    updatedAt: '2026-10-07T00:00:00.000Z',
    nodes,
    edges,
  };
}

const primary: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: defaultGodData(),
};

function repo(id: string, path: string): GraphNode {
  return {
    id,
    type: 'artifact',
    position: { x: 1, y: 0 },
    data: {
      kind: 'repo',
      label: id,
      prompt: '',
      connected: true,
      repoPath: path,
    },
  };
}

describe('resolveConnectedRepos', () => {
  it('пустой граф → нет cwd', () => {
    expect(resolveConnectedRepos(graph([primary], []))).toEqual({
      cwd: undefined,
      paths: [],
      nodes: [],
    });
  });

  it('одна связанная repo → cwd и paths', () => {
    const r = repo('artifact-1', '/tmp/a');
    const g = graph(
      [primary, r],
      [{ id: 'e1', source: GOD_NODE_ID, target: 'artifact-1' }],
    );
    expect(resolveConnectedRepos(g)).toEqual({
      cwd: '/tmp/a',
      paths: ['/tmp/a'],
      nodes: [{ id: 'artifact-1', label: 'artifact-1', path: '/tmp/a' }],
    });
  });

  it('N связанных → cwd = первая по id, paths = все с путём', () => {
    const a = repo('artifact-2', '/tmp/b');
    const b = repo('artifact-1', '/tmp/a');
    const g = graph(
      [primary, a, b],
      [
        { id: 'e1', source: GOD_NODE_ID, target: 'artifact-2' },
        { id: 'e2', source: GOD_NODE_ID, target: 'artifact-1' },
      ],
    );
    const resolved = resolveConnectedRepos(g);
    expect(resolved.cwd).toBe('/tmp/a');
    expect(resolved.paths).toEqual(['/tmp/a', '/tmp/b']);
  });

  it('несвязанная repo не входит', () => {
    const r = repo('artifact-1', '/tmp/a');
    r.data = { ...r.data, connected: false };
    const g = graph([primary, r], []);
    expect(resolveConnectedRepos(g).paths).toEqual([]);
  });

  it('без repoPath пропускает', () => {
    const r = repo('artifact-1', '');
    r.data = { kind: 'repo', label: 'x', prompt: '', connected: true };
    const g = graph(
      [primary, r],
      [{ id: 'e1', source: GOD_NODE_ID, target: 'artifact-1' }],
    );
    expect(resolveConnectedRepos(g).paths).toEqual([]);
  });
});
