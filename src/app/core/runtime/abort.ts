/** Abort / cancel helpers for runtime runs. */

export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

/** delay, прерываемый AbortSignal. */
export function abortableDelay(
  ms: number,
  delayImpl: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) return delayImpl(ms);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      finish(() => reject(new DOMException('Aborted', 'AbortError')));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void delayImpl(ms).then(
      () => {
        finish(() => {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          resolve();
        });
      },
      (err: unknown) => {
        finish(() => reject(err));
      },
    );
  });
}
