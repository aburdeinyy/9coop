import type { ArtifactNodeData, ArtifactNodeSize, GraphNode } from '../models/graph.model';
import { isArtifactData } from '../models/graph.model';

export const ARTIFACT_NODE_W = 160;
export const ARTIFACT_NODE_H = 72;
/** Чуть выше, когда на ноде есть view-превью. */
export const ARTIFACT_NODE_H_VIEW = 128;
/** Repo: список изменённых файлов на плитке. */
export const ARTIFACT_NODE_H_REPO = 168;
export const ARTIFACT_NODE_W_REPO = 200;
export const ARTIFACT_SIZE_MIN_W = 120;
export const ARTIFACT_SIZE_MIN_H = ARTIFACT_NODE_H;
export const ARTIFACT_SIZE_MAX_W = 480;
export const ARTIFACT_SIZE_MAX_H = 420;
export const GOD_NODE_W = 120;
export const GOD_NODE_H = 80;

export interface NodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampArtifactSize(size: ArtifactNodeSize): ArtifactNodeSize {
  return {
    w: Math.min(ARTIFACT_SIZE_MAX_W, Math.max(ARTIFACT_SIZE_MIN_W, Math.round(size.w))),
    h: Math.min(ARTIFACT_SIZE_MAX_H, Math.max(ARTIFACT_SIZE_MIN_H, Math.round(size.h))),
  };
}

/** Кастомный size или дефолт (с учётом view / repo). */
export function resolveArtifactSize(data: ArtifactNodeData): ArtifactNodeSize {
  if (data.size) return clampArtifactSize(data.size);
  if (data.kind === 'repo') {
    return { w: ARTIFACT_NODE_W_REPO, h: ARTIFACT_NODE_H_REPO };
  }
  return {
    w: ARTIFACT_NODE_W,
    h: data.view ? ARTIFACT_NODE_H_VIEW : ARTIFACT_NODE_H,
  };
}

export function artifactNodeHeight(node: GraphNode): number {
  if (node.type !== 'artifact' || !isArtifactData(node.data)) return ARTIFACT_NODE_H;
  return resolveArtifactSize(node.data).h;
}

export function nodeBox(node: GraphNode): NodeBox {
  if (node.type === 'god') {
    return { x: node.position.x, y: node.position.y, w: GOD_NODE_W, h: GOD_NODE_H };
  }
  if (isArtifactData(node.data)) {
    const { w, h } = resolveArtifactSize(node.data);
    return { x: node.position.x, y: node.position.y, w, h };
  }
  return {
    x: node.position.x,
    y: node.position.y,
    w: ARTIFACT_NODE_W,
    h: ARTIFACT_NODE_H,
  };
}

type Side = 'left' | 'right' | 'top' | 'bottom';
export type PortSide = Side;

export const PORT_SIDES: PortSide[] = ['left', 'right', 'top', 'bottom'];

export function portAnchor(box: NodeBox, side: PortSide): { x: number; y: number } {
  switch (side) {
    case 'left':
      return { x: box.x, y: box.y + box.h / 2 };
    case 'right':
      return { x: box.x + box.w, y: box.y + box.h / 2 };
    case 'top':
      return { x: box.x + box.w / 2, y: box.y };
    case 'bottom':
      return { x: box.x + box.w / 2, y: box.y + box.h };
  }
}

function facingSides(a: NodeBox, b: NodeBox): { from: Side; to: Side } {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

export function nodeContainsPoint(
  box: NodeBox,
  x: number,
  y: number,
  pad = 6,
): boolean {
  return (
    x >= box.x - pad &&
    x <= box.x + box.w + pad &&
    y >= box.y - pad &&
    y <= box.y + box.h + pad
  );
}

/** Верхняя (последняя в списке) нода под точкой world. */
export function findNodeAtWorld(
  nodes: GraphNode[],
  x: number,
  y: number,
  excludeId?: string,
): GraphNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (excludeId && n.id === excludeId) continue;
    if (nodeContainsPoint(nodeBox(n), x, y)) return n;
  }
  return null;
}

export function wirePreviewPath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

/** Кубическая кривая между двумя боксами (нода или рамка группы). */
export function cubicPathBetweenBoxes(a: NodeBox, b: NodeBox): string {
  const { from, to } = facingSides(a, b);
  const s = portAnchor(a, from);
  const t = portAnchor(b, to);

  if (from === 'left' || from === 'right') {
    const mx = (s.x + t.x) / 2;
    return `M ${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${t.y}, ${t.x} ${t.y}`;
  }

  const my = (s.y + t.y) / 2;
  return `M ${s.x} ${s.y} C ${s.x} ${my}, ${t.x} ${my}, ${t.x} ${t.y}`;
}

/** Кубическая кривая между ближайшими смотрящими друг на друга рёбрами нод. */
export function cubicEdgePath(source: GraphNode, target: GraphNode): string {
  return cubicPathBetweenBoxes(nodeBox(source), nodeBox(target));
}
