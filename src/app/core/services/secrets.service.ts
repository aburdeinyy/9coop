import { Injectable, signal } from '@angular/core';
import { bridgeBase } from '../runtime/llm-provider';
import { defaultGodData } from '../models/graph.model';

export interface SecretRow {
  id: string;
  key: string;
  value: string;
}

let rowSeq = 0;
function newRow(key = '', value = ''): SecretRow {
  return { id: `secret-row-${++rowSeq}`, key, value };
}

@Injectable({ providedIn: 'root' })
export class SecretsService {
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly path = signal('.env');
  readonly rows = signal<SecretRow[]>([]);

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) void this.reload();
  }

  close(): void {
    this.open.set(false);
  }

  async reload(fetchImpl: typeof fetch = fetch): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const base = bridgeBase(defaultGodData());
      const res = await fetchImpl(`${base}/v1/secrets`);
      if (!res.ok) {
        throw new Error(
          res.status >= 500 || res.status === 0
            ? 'Bridge offline — запусти `npm run bridge`'
            : `HTTP ${res.status}`,
        );
      }
      const json = (await res.json()) as { vars?: Record<string, string>; file?: string };
      const vars = json.vars ?? {};
      this.path.set(json.file ?? '.env');
      // Не подмешиваем дефолтные PAT/URL — иначе удалённые ключи «воскресают» после Save.
      this.rows.set(Object.entries(vars).map(([key, value]) => newRow(key, value)));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  setRow(index: number, patch: Partial<Pick<SecretRow, 'key' | 'value'>>): void {
    this.rows.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  addRow(): void {
    this.rows.update((rows) => [...rows, newRow()]);
  }

  removeRow(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  /** Значение секрета по имени переменной (после reload). */
  valueFor(key: string): string {
    const want = key.trim();
    if (!want) return '';
    return this.rows().find((r) => r.key === want)?.value?.trim() ?? '';
  }

  async save(fetchImpl: typeof fetch = fetch): Promise<boolean> {
    this.saving.set(true);
    this.error.set('');
    try {
      const vars: Record<string, string> = {};
      for (const row of this.rows()) {
        const key = row.key.trim();
        if (!key) continue;
        vars[key] = row.value;
      }
      const base = bridgeBase(defaultGodData());
      const res = await fetchImpl(`${base}/v1/secrets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body.trim() || `HTTP ${res.status}`);
      }
      await this.reload(fetchImpl);
      return true;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
