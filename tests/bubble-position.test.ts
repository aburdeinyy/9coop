import { describe, expect, it } from 'vitest';
import {
  godConfigBubblePosition,
  isStationaryClick,
  nodeChatBubblePosition,
  panToRevealNode,
  zoomAtCursor,
  gridPattern,
  viewWorldTransformCss,
} from '../src/app/core/utils/bubble-position';

describe('isStationaryClick', () => {
  it('считает кликом почти без движения', () => {
    expect(isStationaryClick({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(true);
  });

  it('не считает кликом pan рабочего стола', () => {
    expect(isStationaryClick({ x: 0, y: 0 }, { x: 40, y: 5 })).toBe(false);
  });
});

describe('godConfigBubblePosition', () => {
  it('ставит бабл справа от GOD-ноды с отступом', () => {
    expect(
      godConfigBubblePosition({ x: 100, y: 50 }, { x: 10, y: 20 }, 1, 120),
    ).toEqual({ left: 100 + 10 + 120 + 12, top: 50 + 20, side: 'right' });
  });

  it('учитывает zoom', () => {
    expect(
      godConfigBubblePosition({ x: 100, y: 50 }, { x: 0, y: 0 }, 2, 120),
    ).toEqual({ left: 100 * 2 + 120 * 2 + 12, top: 50 * 2, side: 'right' });
  });
});

describe('nodeChatBubblePosition viewport', () => {
  it('переносит бабл слева от ноды, если справа не влезает в холст', () => {
    // нода у правого края: справа 300px не влезает → слева
    const pos = nodeChatBubblePosition(
      { x: 400, y: 80 },
      { x: 0, y: 0 },
      1,
      160,
      { viewport: { w: 500, h: 600 }, bubbleWidth: 300, margin: 8 },
    );
    expect(pos.side).toBe('left');
    expect(pos.left).toBe(400 - 12 - 300);
    expect(pos.left + 300).toBeLessThanOrEqual(500 - 8);
  });

  it('не отрывает top от ноды — ограничивает maxHeight', () => {
    const pos = nodeChatBubblePosition(
      { x: 40, y: 400 },
      { x: 0, y: 0 },
      1,
      120,
      { viewport: { w: 800, h: 600 }, bubbleWidth: 300, margin: 8 },
    );
    expect(pos.top).toBe(400);
    expect(pos.maxHeight).toBe(600 - 8 - 400);
    expect(pos.side).toBe('right');
  });

  it('при пане вверх следует за нодой и не уезжает выше margin', () => {
    const pos = nodeChatBubblePosition(
      { x: 40, y: 10 },
      { x: 0, y: -40 },
      1,
      120,
      { viewport: { w: 800, h: 600 }, bubbleWidth: 300, margin: 8 },
    );
    // nodeTop = 10 - 40 = -30 → clamp к margin
    expect(pos.top).toBe(8);
    expect(pos.maxHeight).toBe(600 - 8 - 8);
  });

  it('остаётся справа, если места достаточно', () => {
    const pos = nodeChatBubblePosition(
      { x: 40, y: 40 },
      { x: 0, y: 0 },
      1,
      120,
      { viewport: { w: 900, h: 700 }, bubbleWidth: 300 },
    );
    expect(pos).toMatchObject({ left: 40 + 120 + 12, top: 40, side: 'right' });
    expect(pos.maxHeight).toBe(700 - 8 - 40);
  });
});

describe('panToRevealNode', () => {
  it('сдвигает pan, если нода уходит за правый край холста', () => {
    expect(
      panToRevealNode({
        node: { x: 280, y: 40, w: 160, h: 72 },
        pan: { x: 0, y: 0 },
        zoom: 1,
        canvas: { w: 349, h: 800 },
      }),
    ).toEqual({ x: 349 - 16 - (280 + 160), y: 0 });
  });

  it('не трогает pan, если нода уже целиком видна', () => {
    expect(
      panToRevealNode({
        node: { x: 80, y: 120, w: 120, h: 80 },
        pan: { x: 0, y: 0 },
        zoom: 1,
        canvas: { w: 800, h: 600 },
      }),
    ).toBeNull();
  });
});

describe('zoomAtCursor', () => {
  it('оставляет точку под курсором на месте', () => {
    const next = zoomAtCursor({
      pan: { x: 0, y: 0 },
      zoom: 1,
      cursor: { x: 100, y: 80 },
      delta: 1,
    });
    expect(next.zoom).toBe(2);
    expect(next.pan).toEqual({ x: -100, y: -80 });
  });

  it('не двигает холст на пределе масштаба', () => {
    const next = zoomAtCursor({
      pan: { x: 10, y: 20 },
      zoom: 2,
      cursor: { x: 40, y: 40 },
      delta: 0.5,
    });
    expect(next).toEqual({ pan: { x: 10, y: 20 }, zoom: 2 });
  });
});

describe('gridPattern', () => {
  it('увеличивает шаг и точку пропорционально zoom и следует за pan', () => {
    expect(gridPattern({ x: 10, y: 20 }, 1)).toEqual({
      width: 24,
      height: 24,
      x: 10,
      y: 20,
      r: 1,
    });
    expect(gridPattern({ x: 10, y: 20 }, 2)).toEqual({
      width: 48,
      height: 48,
      x: 10,
      y: 20,
      r: 2,
    });
  });
});

describe('viewWorldTransformCss', () => {
  it('следует за pan/zoom в CSS-единицах', () => {
    expect(viewWorldTransformCss({ x: 40, y: -12 }, 1.5)).toBe(
      'translate(40px, -12px) scale(1.5)',
    );
  });
});
