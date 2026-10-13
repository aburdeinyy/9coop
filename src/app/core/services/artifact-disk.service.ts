import { Injectable } from '@angular/core';
import type { ArtifactNodeData } from '../models/graph.model';
import { defaultGodData } from '../models/graph.model';
import { bridgeBase } from '../runtime/llm-provider';
import { collectArtifactDiskPaths } from '../utils/artifact-disk-paths';

@Injectable({ providedIn: 'root' })
export class ArtifactDiskService {
  private base(): string {
    return bridgeBase(defaultGodData()).replace(/\/+$/, '');
  }

  /** Сносит с диска `.layercoop/...` ноды (saveRoot или cwd bridge). */
  async deleteForArtifact(data: ArtifactNodeData): Promise<void> {
    const paths = collectArtifactDiskPaths(data);
    if (!paths.length) return;
    const cwd = data.saveRoot?.trim() || undefined;
    try {
      const res = await fetch(`${this.base()}/v1/fs/delete-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(cwd ? { cwd } : {}), paths }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        console.warn('[layercoop] delete artifacts failed', json.error || res.status);
      }
    } catch (err) {
      console.warn('[layercoop] delete artifacts failed', err);
    }
  }
}
