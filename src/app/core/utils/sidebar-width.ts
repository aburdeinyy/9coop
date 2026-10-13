export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_DEFAULT_WIDTH = 340;
export const SIDEBAR_CANVAS_RESERVE = 320;
export const SIDEBAR_HARD_MAX = 800;

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const max = Math.min(
    SIDEBAR_HARD_MAX,
    Math.max(SIDEBAR_MIN_WIDTH, viewportWidth - SIDEBAR_CANVAS_RESERVE),
  );
  return Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}
