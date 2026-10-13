import { describe, expect, it } from 'vitest';
import {
  GROUP_CELL_H,
  GROUP_CELL_W,
  applyGroupLayout,
  groupFrameRect,
  groupGridCols,
  groupMemberCountLabel,
  normalizeNodeGroups,
  toggleMultiSelectIds,
} from '../src/app/core/utils/node-group';
import { GraphService } from '../src/app/core/services/graph.service';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

describe('node-group layout', () => {
  it('склоняет «нода» в заголовке группы', () => {
    expect(groupMemberCountLabel(1)).toBe('1 нода');
    expect(groupMemberCountLabel(2)).toBe('2 ноды');
    expect(groupMemberCountLabel(3)).toBe('3 ноды');
    expect(groupMemberCountLabel(4)).toBe('4 ноды');
    expect(groupMemberCountLabel(5)).toBe('5 нод');
    expect(groupMemberCountLabel(11)).toBe('11 нод');
    expect(groupMemberCountLabel(21)).toBe('21 нода');
    expect(groupMemberCountLabel(22)).toBe('22 ноды');
    expect(groupMemberCountLabel(25)).toBe('25 нод');
  });

  it('сетка: 2 колонки для 2–4 нод, 3 для большего', () => {
    expect(groupGridCols(2)).toBe(2);
    expect(groupGridCols(4)).toBe(2);
    expect(groupGridCols(5)).toBe(3);
  });

  it('applyGroupLayout ставит фиксированные ячейки', () => {
    const laid = applyGroupLayout(
      { x: 100, y: 50 },
      ['a', 'b', 'c'],
    );
    expect(laid.get('a')).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(laid.get('b')!.x).toBeGreaterThan(laid.get('a')!.x);
    expect(laid.get('c')!.y).toBeGreaterThan(laid.get('a')!.y);
    const frame = groupFrameRect({ x: 100, y: 50 }, 3);
    expect(frame.w).toBeGreaterThan(GROUP_CELL_W);
    expect(frame.h).toBeGreaterThan(GROUP_CELL_H);
  });

  it('toggleMultiSelectIds', () => {
    expect(toggleMultiSelectIds([], 'a')).toEqual(['a']);
    expect(toggleMultiSelectIds(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleMultiSelectIds(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('normalizeNodeGroups чистит битые id', () => {
    const groups = normalizeNodeGroups(
      [{ id: 'g1', memberIds: ['a', 'missing', 'b'], position: { x: 1, y: 2 } }],
      new Set(['a', 'b']),
    );
    expect(groups).toEqual([
      { id: 'g1', memberIds: ['a', 'b'], position: { x: 1, y: 2 } },
    ]);
  });
});

describe('GraphService groups', () => {
  it('ctrl-мультивыбор из 2+ нод создаёт группу и раскладывает сетку; рёбра остаются', () => {
    const svc = new GraphService(memoryStorage());
    const a = svc.addArtifactNode('skill');
    const b = svc.addArtifactNode('skill');
    svc.linkNodes(GOD_NODE_ID, a);
    svc.linkNodes(GOD_NODE_ID, b);
    const edgeCount = svc.graph().edges.length;

    svc.toggleNodeMultiSelect(a);
    expect(svc.graph().groups ?? []).toHaveLength(0);
    svc.toggleNodeMultiSelect(b);

    const groups = svc.graph().groups ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds).toEqual(expect.arrayContaining([a, b]));
    expect(svc.graph().edges).toHaveLength(edgeCount);

    const na = svc.graph().nodes.find((n) => n.id === a)!;
    const nb = svc.graph().nodes.find((n) => n.id === b)!;
    expect(na.position.x).not.toBe(nb.position.x);

    svc.ungroup(groups[0]!.id);
    expect(svc.graph().groups ?? []).toHaveLength(0);
    expect(svc.graph().edges).toHaveLength(edgeCount);
  });

  it('selectGroupOf выделяет всех членов группы', () => {
    const svc = new GraphService(memoryStorage());
    const a = svc.addArtifactNode('skill');
    const b = svc.addArtifactNode('skill');
    svc.toggleNodeMultiSelect(a);
    svc.toggleNodeMultiSelect(b);
    svc.clearMultiSelect();
    expect(svc.multiSelectIds()).toEqual([]);
    expect(svc.selectGroupOf(a)).toBe(true);
    expect(svc.multiSelectIds()).toEqual(expect.arrayContaining([a, b]));
    expect(svc.selectedNodeId()).toBe(a);
  });

  it('moveGroupBy сдвигает всех членов', () => {
    const svc = new GraphService(memoryStorage());
    const a = svc.addArtifactNode('skill');
    const b = svc.addArtifactNode('skill');
    svc.toggleNodeMultiSelect(a);
    svc.toggleNodeMultiSelect(b);
    const g = svc.graph().groups![0]!;
    const before = svc.graph().nodes.find((n) => n.id === a)!.position;
    svc.moveGroupBy(g.id, 40, -10);
    const after = svc.graph().nodes.find((n) => n.id === a)!.position;
    expect(after.x).toBe(before.x + 40);
    expect(after.y).toBe(before.y - 10);
  });
});
