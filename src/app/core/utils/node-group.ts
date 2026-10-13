import type { NodeGroup } from '../models/graph.model';

export const GROUP_PAD = 18;
export const GROUP_GAP = 14;
export const GROUP_CELL_W = 168;
export const GROUP_CELL_H = 96;
export const GROUP_HEADER = 28;

export function groupGridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** Русское склонение: one / few (2–4) / many. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

/** Подпись заголовка группы: «2 ноды», «5 нод». */
export function groupMemberCountLabel(count: number): string {
  return `${count} ${pluralRu(count, 'нода', 'ноды', 'нод')}`;
}

export function groupFrameSize(
  count: number,
  cols = groupGridCols(count),
): { w: number; h: number } {
  const n = Math.max(0, count);
  if (n === 0) return { w: GROUP_PAD * 2, h: GROUP_HEADER + GROUP_PAD };
  const rows = Math.ceil(n / cols);
  return {
    w: GROUP_PAD * 2 + cols * GROUP_CELL_W + (cols - 1) * GROUP_GAP,
    h: GROUP_HEADER + GROUP_PAD * 2 + rows * GROUP_CELL_H + (rows - 1) * GROUP_GAP,
  };
}

export function groupFrameRect(
  origin: { x: number; y: number },
  count: number,
  cols = groupGridCols(count),
): { x: number; y: number; w: number; h: number } {
  const size = groupFrameSize(count, cols);
  return { x: origin.x, y: origin.y, ...size };
}

export function memberCellOffset(
  index: number,
  cols = groupGridCols(index + 1),
): { x: number; y: number } {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: GROUP_PAD + col * (GROUP_CELL_W + GROUP_GAP),
    y: GROUP_HEADER + GROUP_PAD + row * (GROUP_CELL_H + GROUP_GAP),
  };
}

/** Позиции членов относительно origin рамки (top-left). */
export function applyGroupLayout(
  origin: { x: number; y: number },
  memberIds: string[],
): Map<string, { x: number; y: number }> {
  const cols = groupGridCols(memberIds.length);
  const out = new Map<string, { x: number; y: number }>();
  memberIds.forEach((id, i) => {
    const off = memberCellOffset(i, cols);
    out.set(id, { x: origin.x + off.x, y: origin.y + off.y });
  });
  return out;
}

export function toggleMultiSelectIds(current: string[], nodeId: string): string[] {
  if (current.includes(nodeId)) return current.filter((id) => id !== nodeId);
  return [...current, nodeId];
}

export function normalizeNodeGroups(
  raw: unknown,
  validNodeIds: Set<string>,
): NodeGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: NodeGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || !o['id'].trim()) continue;
    const pos = o['position'] && typeof o['position'] === 'object' && !Array.isArray(o['position'])
      ? (o['position'] as Record<string, unknown>)
      : {};
    const x = Number(pos['x']);
    const y = Number(pos['y']);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const members = Array.isArray(o['memberIds'])
      ? o['memberIds'].filter((id): id is string => typeof id === 'string' && validNodeIds.has(id))
      : [];
    if (members.length < 2) continue;
    out.push({
      id: o['id'].trim(),
      memberIds: members,
      position: { x, y },
    });
  }
  return out;
}

/** Origin рамки: чуть выше/левее минимальных координат членов. */
export function originFromMemberPositions(
  positions: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  if (!positions.length) return { x: 0, y: 0 };
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  return { x: minX - GROUP_PAD, y: minY - GROUP_HEADER - GROUP_PAD };
}
