import type { RuntimeEvent } from '../runtime/runtime-events';

export type ContextVisualState = {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
};

const EMPTY: ContextVisualState = {
  nodeIds: new Set(),
  edgeIds: new Set(),
};

/** Контекст рана: горит до run:end / cancel, node:done его не гасит. */
export function reduceContextVisual(
  prev: ContextVisualState | undefined,
  event: RuntimeEvent,
): ContextVisualState {
  const state = prev ?? EMPTY;
  switch (event.type) {
    case 'run:context':
      return {
        nodeIds: new Set(event.nodeIds),
        edgeIds: new Set(event.edgeIds),
      };
    case 'run:start':
      return EMPTY;
    case 'run:end':
    case 'run:cancelled':
      return EMPTY;
    default:
      return state;
  }
}
