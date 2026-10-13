import { Injectable, inject, signal } from '@angular/core';
import { defaultGodData, isArtifactData } from '../models/graph.model';
import { bridgeBase } from '../runtime/llm-provider';
import {
  buildLayercoopRefreshSource,
  formatCountdown,
  formatRefreshInterval,
  msUntilNextRefresh,
  parseMrIidFromTitle,
  pickRefreshProgram,
  type LayercoopRefreshProgram,
} from '../utils/auto-refresh';
import { buildAdjacency } from '../utils/graph-links';
import { parseViewSpec } from '../utils/node-view';
import { GraphService } from './graph.service';

/** Тик автообновления: исполняет код MCP, модель не вызывает. */
@Injectable({ providedIn: 'root' })
export class ViewRefreshService {
  private readonly graphService = inject(GraphService);
  private readonly last = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Секундный тик для countdown в UI. */
  readonly clock = signal(Date.now());
  readonly refreshingNodeId = signal<string | null>(null);

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.clock.set(Date.now());
      void this.tick();
    }, 1000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  lastRefreshAt(nodeId: string): number {
    return this.last.get(nodeId) ?? 0;
  }

  nextRefreshHint(nodeId: string, intervalMs: number): string {
    void this.clock();
    const left = msUntilNextRefresh(this.lastRefreshAt(nodeId), intervalMs, Date.now());
    const every = formatRefreshInterval(intervalMs);
    if (!this.lastRefreshAt(nodeId)) {
      return `Cron · каждые ${every} · первый тик скоро`;
    }
    if (left <= 0) return `Cron · каждые ${every} · обновление…`;
    return `Cron · каждые ${every} · через ${formatCountdown(left)}`;
  }

  async forceRefresh(nodeId: string): Promise<void> {
    await this.refreshNode(nodeId, true);
  }

  private async tick(now = Date.now()): Promise<void> {
    const graph = this.graphService.graph();
    for (const node of graph.nodes) {
      if (node.type !== 'artifact' || !isArtifactData(node.data) || !node.data.autoRefresh) continue;
      const interval = node.data.autoRefresh.intervalMs;
      const prev = this.last.get(node.id) ?? 0;
      if (now - prev < interval || this.inflight.has(node.id)) continue;
      await this.refreshNode(node.id, false);
    }
  }

  /** Старые плитки звали list_pipeline_jobs с {} — подставим MR iid из title. */
  private withMrArgs(
    program: LayercoopRefreshProgram,
    titleHint: string,
  ): LayercoopRefreshProgram {
    if (program.source.includes('merge_request_iid')) return program;
    if (!program.source.includes('list_pipeline_jobs')) return program;
    const mrIid = parseMrIidFromTitle(titleHint);
    if (!mrIid) return program;
    return {
      ...program,
      source: buildLayercoopRefreshSource(titleHint, 'list_pipeline_jobs', {
        merge_request_iid: mrIid,
      }),
    };
  }

  private async refreshNode(nodeId: string, force: boolean): Promise<void> {
    const graph = this.graphService.graph();
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'artifact' || !isArtifactData(node.data) || !node.data.autoRefresh) {
      return;
    }
    if (this.inflight.has(nodeId)) return;

    const adj = buildAdjacency(graph);
    const neighborContents = (adj.get(nodeId) ?? []).flatMap((id) => {
      const other = graph.nodes.find((n) => n.id === id);
      if (!other || other.type !== 'artifact' || !isArtifactData(other.data)) return [];
      if (other.data.kind !== 'mcp' || !other.data.artifactContent) return [];
      return [other.data.artifactContent];
    });
    const picked = pickRefreshProgram(node.data.artifactContent, neighborContents);
    if (!picked) {
      if (force) {
        // Нет MCP-программы — всё равно отметим тик, чтобы countdown сдвинулся.
        this.last.set(nodeId, Date.now());
      }
      return;
    }

    const titleHint =
      (node.data.view && 'title' in node.data.view && node.data.view.title?.trim()) ||
      node.data.label ||
      '';
    const program = this.withMrArgs(picked.program, titleHint);

    const now = Date.now();
    const interval = node.data.autoRefresh.intervalMs;
    this.inflight.add(nodeId);
    this.refreshingNodeId.set(nodeId);
    try {
      const base = bridgeBase(defaultGodData());
      const res = await fetch(`${base}/v1/mcp/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactContent: picked.artifactContent,
          server: program.server,
          source: program.source,
        }),
      });
      if (!res.ok) {
        // не сдвигаем полный интервал — повторить через ~5с
        this.last.set(nodeId, now - interval + 5_000);
        return;
      }
      const body = (await res.json()) as { view?: unknown };
      const view = parseViewSpec(body.view);
      if (view) this.graphService.setNodeView(nodeId, view);
      this.last.set(nodeId, now);
    } catch {
      this.last.set(nodeId, now - interval + 5_000);
    } finally {
      this.inflight.delete(nodeId);
      if (this.refreshingNodeId() === nodeId) this.refreshingNodeId.set(null);
    }
  }
}
