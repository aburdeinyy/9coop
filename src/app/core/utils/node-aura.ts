/** Размытое свечение под нодой в мировых координатах (едет с pan/zoom). */
export function nodeAuraBox(
  position: { x: number; y: number },
  size: { w: number; h: number },
  pan: { x: number; y: number },
  zoom: number,
  spread = 0.75,
): { left: number; top: number; width: number; height: number } {
  const width = size.w * (1 + spread);
  const height = size.h * (1 + spread);
  const ox = (width - size.w) / 2;
  const oy = (height - size.h) / 2;
  return {
    left: (position.x - ox) * zoom + pan.x,
    top: (position.y - oy) * zoom + pan.y,
    width,
    height,
  };
}
