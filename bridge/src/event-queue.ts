/**
 * Мост из callback-мира (stdout процесса, SSE-ридер) в async-генератор раннера.
 * push() до close(); после close() поток отдаёт остаток и завершается.
 */
export interface EventQueue<T> {
  push(item: T): void;
  close(): void;
  stream(): AsyncGenerator<T>;
}

export function createEventQueue<T>(): EventQueue<T> {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const signal = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };

  return {
    push(item: T): void {
      if (closed) return;
      items.push(item);
      signal();
    },
    close(): void {
      closed = true;
      signal();
    },
    async *stream(): AsyncGenerator<T> {
      while (true) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/** Разбивает поток чанков на строки, храня хвост между вызовами. */
export function createLineSplitter(onLine: (line: string) => void): {
  push(chunk: string): void;
  flush(): void;
} {
  let buf = '';
  return {
    push(chunk: string): void {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    },
    flush(): void {
      const trimmed = buf.trim();
      buf = '';
      if (trimmed) onLine(trimmed);
    },
  };
}
