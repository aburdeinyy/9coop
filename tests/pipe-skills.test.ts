import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID, type LayercoopGraph } from '../src/app/core/models/graph.model';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import {
  buildPipeRunPrompt,
  listPipeSkills,
  pipeLooksLikeGitlabMr,
} from '../src/app/core/utils/pipe-skills';
import { GraphService } from '../src/app/core/services/graph.service';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

function skill(
  id: string,
  label: string,
  opts: { pipe?: boolean; connected?: boolean } = {},
): LayercoopGraph['nodes'][number] {
  return {
    id,
    type: 'artifact',
    position: { x: 0, y: 0 },
    data: {
      kind: 'skill',
      label,
      prompt: `спека ${label}`,
      connected: opts.connected === true,
      ...(opts.pipe ? { pipe: true } : {}),
    },
  };
}

describe('pipe-skills', () => {
  it('listPipeSkills — только skill с галочкой pipe', () => {
    const graph: LayercoopGraph = {
      nodes: [
        {
          id: GOD_NODE_ID,
          type: 'god',
          position: { x: 0, y: 0 },
          data: { label: 'GOD', runner: 'cursor', model: '', baseUrl: '', apiKey: '', temperature: 0.2 },
        },
        skill('pipe-mr', 'GitLab MR', { pipe: true }),
        skill('plain', 'Обычный skill'),
        skill('linked-pipe', 'Linked pipe', { pipe: true, connected: true }),
        {
          id: 'mcp-1',
          type: 'artifact',
          position: { x: 0, y: 0 },
          data: {
            kind: 'mcp',
            label: 'GitLab MCP',
            prompt: '',
            connected: true,
            pipe: true,
          },
        },
      ],
      edges: [
        { id: 'e1', source: GOD_NODE_ID, target: 'linked-pipe' },
        { id: 'e2', source: GOD_NODE_ID, target: 'mcp-1' },
      ],
    };

    const pipes = listPipeSkills(graph);
    expect(pipes.map((p) => p.id).sort()).toEqual(['linked-pipe', 'pipe-mr']);
    expect(pipes.every((p) => p.label !== 'Обычный skill')).toBe(true);
  });

  it('listPipeSkills сортирует по label', () => {
    const graph: LayercoopGraph = {
      nodes: [
        {
          id: GOD_NODE_ID,
          type: 'god',
          position: { x: 0, y: 0 },
          data: { label: 'GOD', runner: 'cursor', model: '', baseUrl: '', apiKey: '', temperature: 0.2 },
        },
        skill('b', 'Beta pipe', { pipe: true }),
        skill('a', 'Alpha pipe', { pipe: true }),
      ],
      edges: [],
    };
    expect(listPipeSkills(graph).map((p) => p.label)).toEqual([
      'Alpha pipe',
      'Beta pipe',
    ]);
  });

  it('buildPipeRunPrompt упоминает пайп и фокус', () => {
    const text = buildPipeRunPrompt(
      { id: 'pipe-mr', label: 'GitLab MR', prompt: 'создай MR' },
      'багфикс нода',
    );
    expect(text).toContain('GitLab MR');
    expect(text).toContain('багфикс нода');
    expect(text.toLowerCase()).toMatch(/пайп|pipe/);
  });

  it('buildPipeRunPrompt для GitLab MR требует spawn pipeline-плитки', () => {
    expect(
      pipeLooksLikeGitlabMr({ label: 'GitLab MR', prompt: 'merge request' }),
    ).toBe(true);
    const text = buildPipeRunPrompt(
      { id: 'p', label: 'GitLab MR', prompt: 'создай MR' },
      'фикс',
    );
    expect(text).toContain('spawn');
    expect(text).toMatch(/layercoop-view/i);
    expect(text.toLowerCase()).toMatch(/pipeline|пайплайн|jobs/);
    expect(text).toMatch(/Approval|approvals?/i);
  });

  it('setArtifactPipe включает скилл в listPipeSkills', () => {
    const svc = new GraphService(memoryStorage());
    const id = svc.addArtifactNode('skill');
    expect(listPipeSkills(svc.graph())).toHaveLength(0);
    svc.setArtifactPipe(id, true);
    expect(listPipeSkills(svc.graph()).map((p) => p.id)).toEqual([id]);
    svc.setArtifactPipe(id, false);
    expect(listPipeSkills(svc.graph())).toHaveLength(0);
  });

  it('composeChatContext без force не видит отсоединённый пайп; с force — включает body', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 'demo',
      updatedAt: '2026-10-13T00:00:00.000Z',
      nodes: [
        {
          id: GOD_NODE_ID,
          type: 'god',
          position: { x: 0, y: 0 },
          data: { label: 'GOD' },
        },
        {
          id: 'focus-1',
          type: 'artifact',
          position: { x: 1, y: 1 },
          data: {
            kind: 'skill',
            label: 'Багфикс',
            prompt: 'починить баг',
            connected: true,
          },
        },
        {
          id: 'pipe-mr',
          type: 'artifact',
          position: { x: 2, y: 2 },
          data: {
            kind: 'skill',
            label: 'GitLab MR',
            prompt: 'создай MR',
            artifactContent: 'PIPE_MR_FULL_BODY',
            connected: false,
            pipe: true,
          },
        },
      ],
      edges: [{ id: 'e1', source: GOD_NODE_ID, target: 'focus-1' }],
    };

    const plain = composeChatContext(graph, 'hi', { focusNodeId: 'focus-1' });
    expect(plain.selectedArtifactIds).not.toContain('pipe-mr');
    expect(plain.systemPrompt).not.toContain('PIPE_MR_FULL_BODY');

    const forced = composeChatContext(graph, 'hi', {
      focusNodeId: 'focus-1',
      forceArtifactIds: ['pipe-mr'],
    });
    expect(forced.selectedArtifactIds).toContain('pipe-mr');
    expect(forced.systemPrompt).toContain('PIPE_MR_FULL_BODY');
    expect(forced.systemPrompt).toMatch(/пайп/i);
  });
});
