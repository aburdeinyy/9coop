export const CLICK_MOVE_THRESHOLD_PX = 4;
export const NODE_CHAT_BUBBLE_WIDTH = 300;
export const NODE_CHAT_BUBBLE_MIN_HEIGHT = 120;
export const NODE_CHAT_BUBBLE_GAP = 12;

export function isStationaryClick(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thresholdPx = CLICK_MOVE_THRESHOLD_PX,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy <= thresholdPx * thresholdPx;
}

export type ChatBubblePlacement = {
  left: number;
  top: number;
  /** Относительно ноды: caret смотрит на ноду с этой стороны бабла. */
  side: 'left' | 'right';
  /** Ограничение высоты под оставшееся место на холсте. */
  maxHeight?: number;
};

export type ChatBubblePositionOpts = {
  gap?: number;
  bubbleWidth?: number;
  minHeight?: number;
  /** Размер видимого холста (без сайдбара чата). */
  viewport?: { w: number; h: number };
  margin?: number;
};

/**
 * Бабл настроек рядом с нодой. Без viewport — всегда справа.
 * С viewport — flip влево / clamp по X; по Y следует за нодой и режет maxHeight,
 * чтобы при пане не отлипать и не уезжать за край.
 */
export function nodeChatBubblePosition(
  nodePosition: { x: number; y: number },
  pan: { x: number; y: number },
  zoom: number,
  nodeWidth: number,
  opts: ChatBubblePositionOpts = {},
): ChatBubblePlacement {
  const gap = opts.gap ?? NODE_CHAT_BUBBLE_GAP;
  const bubbleW = opts.bubbleWidth ?? NODE_CHAT_BUBBLE_WIDTH;
  const minH = opts.minHeight ?? NODE_CHAT_BUBBLE_MIN_HEIGHT;
  const margin = opts.margin ?? 8;
  const nodeLeft = nodePosition.x * zoom + pan.x;
  const nodeTop = nodePosition.y * zoom + pan.y;
  const nodeScreenW = nodeWidth * zoom;

  let left = nodeLeft + nodeScreenW + gap;
  let side: 'left' | 'right' = 'right';
  let top = nodeTop;
  let maxHeight: number | undefined;

  const vp = opts.viewport;
  if (vp && vp.w > 0 && vp.h > 0) {
    const maxLeft = Math.max(margin, vp.w - margin - bubbleW);
    if (left + bubbleW > vp.w - margin) {
      const leftOfNode = nodeLeft - gap - bubbleW;
      if (leftOfNode >= margin) {
        left = leftOfNode;
        side = 'left';
      } else {
        left = Math.min(Math.max(margin, left), maxLeft);
      }
    }

    // Держим top у ноды; только не даём уехать выше margin / ниже чем minH от низа.
    if (top < margin) top = margin;
    const floorTop = Math.max(margin, vp.h - margin - minH);
    if (top > floorTop) top = floorTop;
    maxHeight = Math.max(minH, vp.h - margin - top);
  }

  return { left, top, side, maxHeight };
}

/** @deprecated use nodeChatBubblePosition */
export const godConfigBubblePosition = nodeChatBubblePosition;

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
export const GRID_STEP = 24;

/** Сетка в экранных координатах: шаг и радиус точки растут вместе с zoom. */
export function gridPattern(
  pan: { x: number; y: number },
  zoom: number,
  step = GRID_STEP,
): { width: number; height: number; x: number; y: number; r: number } {
  const size = step * zoom;
  return { width: size, height: size, x: pan.x, y: pan.y, r: zoom };
}

/** CSS transform мира (атмосфера/слои) — с единицами, в отличие от SVG. */
export function viewWorldTransformCss(
  pan: { x: number; y: number },
  zoom: number,
): string {
  return `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
}

/** Меняет масштаб так, чтобы точка под курсором осталась на месте. */
export function zoomAtCursor(input: {
  pan: { x: number; y: number };
  zoom: number;
  cursor: { x: number; y: number };
  delta: number;
  min?: number;
  max?: number;
}): { pan: { x: number; y: number }; zoom: number } {
  const min = input.min ?? ZOOM_MIN;
  const max = input.max ?? ZOOM_MAX;
  const nextZoom = Math.min(Math.max(input.zoom + input.delta, min), max);
  if (nextZoom === input.zoom) return { pan: { ...input.pan }, zoom: input.zoom };
  const worldX = (input.cursor.x - input.pan.x) / input.zoom;
  const worldY = (input.cursor.y - input.pan.y) / input.zoom;
  return {
    zoom: nextZoom,
    pan: {
      x: input.cursor.x - worldX * nextZoom,
      y: input.cursor.y - worldY * nextZoom,
    },
  };
}

const REVEAL_MARGIN = 16;

/**
 * Сдвигает pan так, чтобы прямоугольник ноды целиком попал в холст.
 * null — нода уже видна, pan менять не нужно.
 */
export function panToRevealNode(input: {
  node: { x: number; y: number; w: number; h: number };
  pan: { x: number; y: number };
  zoom: number;
  canvas: { w: number; h: number };
  margin?: number;
}): { x: number; y: number } | null {
  const margin = input.margin ?? REVEAL_MARGIN;
  const z = input.zoom || 1;
  const fit = (origin: number, size: number, pan: number, canvas: number): number => {
    let next = pan;
    const end = origin * z + next + size * z;
    if (end > canvas - margin) next -= end - (canvas - margin);
    const start = origin * z + next;
    if (start < margin) next += margin - start;
    return next;
  };
  const x = fit(input.node.x, input.node.w, input.pan.x, input.canvas.w);
  const y = fit(input.node.y, input.node.h, input.pan.y, input.canvas.h);
  if (x === input.pan.x && y === input.pan.y) return null;
  return { x, y };
}
