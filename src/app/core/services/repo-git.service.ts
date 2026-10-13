import { Injectable, inject, signal } from '@angular/core';
import { bridgeBase } from '../runtime/llm-provider';
import { defaultGodData } from '../models/graph.model';
import { GraphService } from './graph.service';
import { resolveConnectedRepos } from '../utils/resolve-repos';
import { isArtifactData } from '../models/graph.model';

export type RepoGitFile = { path: string; status: string };

export type RepoGitStatus = {
  branch: string;
  files: RepoGitFile[];
  totals: { changed: number };
  error?: string;
};

@Injectable({ providedIn: 'root' })
export class RepoGitService {
  private readonly graph = inject(GraphService);

  /** nodeId → последний status */
  readonly statusByNodeId = signal<Record<string, RepoGitStatus>>({});
  readonly loadingNodeId = signal<string | null>(null);

  private base(): string {
    return bridgeBase(defaultGodData()).replace(/\/+$/, '');
  }

  statusFor(nodeId: string): RepoGitStatus | undefined {
    return this.statusByNodeId()[nodeId];
  }

  async refreshNode(nodeId: string): Promise<RepoGitStatus | null> {
    const node = this.graph.graph().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data) || node.data.kind !== 'repo') {
      return null;
    }
    const path = node.data.repoPath?.trim() ?? '';
    if (!path) {
      const empty: RepoGitStatus = {
        branch: '',
        files: [],
        totals: { changed: 0 },
        error: 'Укажите путь к репозиторию',
      };
      this.statusByNodeId.update((m) => ({ ...m, [nodeId]: empty }));
      return empty;
    }

    this.loadingNodeId.set(nodeId);
    try {
      const res = await fetch(`${this.base()}/v1/git/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const json = (await res.json().catch(() => ({}))) as RepoGitStatus & { error?: string };
      if (!res.ok) {
        const err: RepoGitStatus = {
          branch: '',
          files: [],
          totals: { changed: 0 },
          error: json.error || `HTTP ${res.status}`,
        };
        this.statusByNodeId.update((m) => ({ ...m, [nodeId]: err }));
        return err;
      }
      const ok: RepoGitStatus = {
        branch: json.branch ?? '',
        files: Array.isArray(json.files) ? json.files : [],
        totals: json.totals ?? { changed: 0 },
      };
      this.statusByNodeId.update((m) => ({ ...m, [nodeId]: ok }));
      return ok;
    } catch (e) {
      const err: RepoGitStatus = {
        branch: '',
        files: [],
        totals: { changed: 0 },
        error: e instanceof Error ? e.message : String(e),
      };
      this.statusByNodeId.update((m) => ({ ...m, [nodeId]: err }));
      return err;
    } finally {
      if (this.loadingNodeId() === nodeId) this.loadingNodeId.set(null);
    }
  }

  async refreshConnected(): Promise<void> {
    const { nodes } = resolveConnectedRepos(this.graph.graph());
    await Promise.all(nodes.map((n) => this.refreshNode(n.id)));
  }

  async fetchDiff(repoPath: string, file: string): Promise<{ file: string; patch: string }> {
    const res = await fetch(`${this.base()}/v1/git/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: repoPath, file }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      file?: string;
      patch?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return { file: json.file ?? file, patch: json.patch ?? '' };
  }

  /** Системный диалог выбора папки. null = отмена. */
  async pickFolder(): Promise<string | null> {
    const res = await fetch(`${this.base()}/v1/git/pick-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = (await res.json().catch(() => ({}))) as {
      path?: string;
      cancelled?: boolean;
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (json.cancelled || !json.path?.trim()) return null;
    return json.path.trim();
  }
}
