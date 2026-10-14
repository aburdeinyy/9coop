import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';
import { loadWorkspace, saveWorkspace } from '../src/app/core/utils/workspace-persist';
import { buildGroupEdgeVisuals } from '../src/app/core/utils/group-edge-visual';
import { cubicPathBetweenBoxes, nodeBox } from '../src/app/core/utils/edge-path';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

describe('edge port anchors', () => {
  it('linkNodes с sides создаёт и обновляет якоря', () => {
    const svc = new GraphService(memoryStorage());
    const id = svc.addArtifactNode('skill');
    svc.linkNodes(GOD_NODE_ID, id, { sourceSide: 'right', targetSide: 'left' });
    let edge = svc.graph().edges.find((e) => e.source === GOD_NODE_ID && e.target === id);
    expect(edge?.sourceSide).toBe('right');
    expect(edge?.targetSide).toBe('left');

    svc.linkNodes(GOD_NODE_ID, id, { sourceSide: 'bottom', targetSide: 'top' });
    edge = svc.graph().edges.find((e) => e.source === GOD_NODE_ID && e.target === id);
    expect(edge?.sourceSide).toBe('bottom');
    expect(edge?.targetSide).toBe('top');
    expect(svc.graph().edges.filter((e) => e.source === GOD_NODE_ID || e.target === GOD_NODE_ID)).toHaveLength(
      1,
    );
  });

  it('linkNodes обновляет sides при обратном порядке концов на ребре', () => {
    const svc = new GraphService(memoryStorage());
    const id = svc.addArtifactNode('skill');
    svc.linkNodes(id, GOD_NODE_ID, { sourceSide: 'left', targetSide: 'right' });
    const edge = svc.graph().edges.find(
      (e) =>
        (e.source === id && e.target === GOD_NODE_ID) ||
        (e.source === GOD_NODE_ID && e.target === id),
    );
    expect(edge).toBeTruthy();
    if (!edge) throw new Error('edge');
    if (edge.source === id) {
      expect(edge.sourceSide).toBe('left');
      expect(edge.targetSide).toBe('right');
    } else {
      expect(edge.sourceSide).toBe('right');
      expect(edge.targetSide).toBe('left');
    }

    svc.linkNodes(GOD_NODE_ID, id, { sourceSide: 'top', targetSide: 'bottom' });
    const again = svc.graph().edges.find((e) => e.id === edge.id)!;
    if (again.source === GOD_NODE_ID) {
      expect(again.sourceSide).toBe('top');
      expect(again.targetSide).toBe('bottom');
    } else {
      expect(again.sourceSide).toBe('bottom');
      expect(again.targetSide).toBe('top');
    }
  });

  it('persist/load сохраняет sourceSide/targetSide', () => {
    const storage = memoryStorage();
    const svc = new GraphService(storage);
    const id = svc.addArtifactNode('skill');
    svc.linkNodes(GOD_NODE_ID, id, { sourceSide: 'right', targetSide: 'left' });
    const loaded = loadWorkspace(storage);
    const edge = loaded?.graph.edges.find((e) => e.target === id || e.source === id);
    expect(edge?.sourceSide).toBe('right');
    expect(edge?.targetSide).toBe('left');

    saveWorkspace(storage, {
      graph: loaded!.graph,
      nodeChats: loaded!.nodeChats,
      selectedNodeId: loaded!.selectedNodeId,
    });
    const again = loadWorkspace(storage);
    const edge2 = again?.graph.edges.find((e) => e.target === id || e.source === id);
    expect(edge2?.sourceSide).toBe('right');
    expect(edge2?.targetSide).toBe('left');
  });

  it('buildGroupEdgeVisuals использует fixed sides ребра', () => {
    const god = {
      id: GOD_NODE_ID,
      type: 'god' as const,
      position: { x: 0, y: 0 },
      data: defaultGodData(),
    };
    const skill = {
      id: 's1',
      type: 'artifact' as const,
      position: { x: 300, y: 0 },
      data: { kind: 'skill' as const, label: 'S', prompt: '', connected: true },
    };
    const edges = [
      {
        id: 'e1',
        source: GOD_NODE_ID,
        target: 's1',
        sourceSide: 'top' as const,
        targetSide: 'bottom' as const,
      },
    ];
    const visuals = buildGroupEdgeVisuals(edges, [god, skill], []);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.path).toBe(
      cubicPathBetweenBoxes(nodeBox(god), nodeBox(skill), { from: 'top', to: 'bottom' }),
    );
  });
});
