import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import { parseWizardDone } from '../src/app/core/utils/node-wizard';
import {
  SAVE_HOME_ID,
  buildSaveTargetOptions,
  parseSaveTargetId,
  resolveSaveRoot,
  resolveWorkspaceCwdForFocus,
  saveRepoOptionId,
} from '../src/app/core/utils/save-target';
import { GraphService } from '../src/app/core/services/graph.service';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

const repos = [
  { id: 'artifact-2', label: 'MyApp', path: '/Users/dev/work/my-app' },
  { id: 'artifact-5', label: 'Other', path: '/tmp/other' },
];

describe('save-target', () => {
  it('parse/build options', () => {
    expect(parseSaveTargetId(SAVE_HOME_ID)).toEqual({ type: 'home' });
    expect(parseSaveTargetId(saveRepoOptionId('artifact-2'))).toEqual({
      type: 'repo',
      repoId: 'artifact-2',
    });
    const opts = buildSaveTargetOptions(repos);
    expect(opts[0]?.id).toBe(SAVE_HOME_ID);
    expect(opts).toHaveLength(3);
    expect(resolveSaveRoot({ type: 'home' }, repos)).toBeUndefined();
    expect(resolveSaveRoot({ type: 'repo', repoId: 'artifact-2' }, repos)).toBe(
      '/Users/dev/work/my-app',
    );
  });

  it('parseWizardDone читает saveTarget', () => {
    expect(
      parseWizardDone({
        done: true,
        label: 'Ponytail',
        prompt: 'skill',
        kind: 'skill',
        saveTarget: SAVE_HOME_ID,
      }),
    ).toMatchObject({ saveTarget: SAVE_HOME_ID });
  });

  it('artifact без saveRoot → cwd Layercoop; с saveRoot → repo; GOD → repo cwd', () => {
    const graph: LayercoopGraph = {
      version: 1,
      name: 't',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [
        { id: GOD_NODE_ID, type: 'god', position: { x: 0, y: 0 }, data: defaultGodData() },
        {
          id: 'artifact-1',
          type: 'artifact',
          position: { x: 0, y: 0 },
          data: { kind: 'skill', label: 'S', prompt: 'p', connected: true },
        },
        {
          id: 'artifact-2',
          type: 'artifact',
          position: { x: 0, y: 0 },
          data: {
            kind: 'repo',
            label: 'MyApp',
            prompt: '',
            connected: true,
            repoPath: '/Users/dev/work/my-app',
          },
        },
        {
          id: 'artifact-3',
          type: 'artifact',
          position: { x: 0, y: 0 },
          data: {
            kind: 'skill',
            label: 'InRepo',
            prompt: 'p',
            connected: true,
            saveRoot: '/Users/dev/work/my-app',
          },
        },
      ],
      edges: [
        { id: 'e1', source: GOD_NODE_ID, target: 'artifact-1' },
        { id: 'e2', source: GOD_NODE_ID, target: 'artifact-2' },
        { id: 'e3', source: GOD_NODE_ID, target: 'artifact-3' },
      ],
    };

    expect(resolveWorkspaceCwdForFocus(graph, 'artifact-1')).toBeUndefined();
    expect(resolveWorkspaceCwdForFocus(graph, 'artifact-3')).toBe('/Users/dev/work/my-app');
    expect(resolveWorkspaceCwdForFocus(graph, GOD_NODE_ID)).toBe('/Users/dev/work/my-app');

    const ctx = composeChatContext(graph, 'hi', { focusNodeId: 'artifact-1' });
    expect(ctx.workspaceCwd).toBeUndefined();
    expect(ctx.systemPrompt).toContain(SAVE_HOME_ID);
    // repo — для чтения кода, не как cwd записи skill с save:home
    expect(ctx.systemPrompt).toMatch(/чтение|read/i);
    expect(ctx.systemPrompt).not.toMatch(
      /cwd \(относительные пути tools\):\s*\/Users\/dev\/work\/my-app/,
    );
    expect(ctx.systemPrompt).toMatch(/запись[\s\S]{0,80}Layercoop|Layercoop[\s\S]{0,40}запис/i);
  });

  it('applyWizardResult / pick saveTarget пишет saveRoot', () => {
    const svc = new GraphService(memoryStorage());
    const skillId = svc.addArtifactNode('skill');
    const repoId = svc.addRepoNode('/Users/dev/work/my-app');
    svc.linkNodes(GOD_NODE_ID, skillId);
    svc.linkNodes(GOD_NODE_ID, repoId);

    svc.applyWizardResult(skillId, {
      done: true,
      label: 'Ponytail',
      prompt: 'always-on skill',
      kind: 'skill',
      saveTarget: saveRepoOptionId(repoId),
    });
    const node = svc.graph().nodes.find((n) => n.id === skillId);
    expect(node?.type).toBe('artifact');
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.saveRoot).toBe('/Users/dev/work/my-app');

    svc.applySaveTargetPick(skillId, SAVE_HOME_ID);
    const again = svc.graph().nodes.find((n) => n.id === skillId);
    if (again?.type !== 'artifact') throw new Error('artifact');
    expect(again.data.saveRoot).toBeUndefined();
  });
});
