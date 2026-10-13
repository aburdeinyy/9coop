import {
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { GraphService } from '../../core/services/graph.service';
import { RuntimeService } from '../../core/services/runtime.service';
import { RepoGitService } from '../../core/services/repo-git.service';
import { SettingsService } from '../../core/services/settings.service';
import { ViewRefreshService } from '../../core/services/view-refresh.service';
import { resolveConnectedRepos } from '../../core/utils/resolve-repos';
import { NodeChatBubbleComponent } from '../node-chat-bubble/node-chat-bubble.component';
import { NodeViewRenderComponent } from '../node-view/node-view-render.component';
import {
  ArtifactNodeData,
  GOD_NODE_ID,
  GodNodeData,
  GraphEdge,
  GraphNode,
  RUNNER_LABELS,
  isArtifactData,
  normalizeGodData,
} from '../../core/models/graph.model';
import { displayModelName } from '../../core/runtime/llm-provider';
import {
  isStationaryClick,
  NODE_CHAT_BUBBLE_WIDTH,
  nodeChatBubblePosition,
  panToRevealNode,
  zoomAtCursor,
  gridPattern,
} from '../../core/utils/bubble-position';
import { listPipeSkills } from '../../core/utils/pipe-skills';
import { isPrimaryGod } from '../../core/utils/god-nodes';
import { nodeAuraBox } from '../../core/utils/node-aura';
import {
  GOD_NODE_H,
  GOD_NODE_W,
  PORT_SIDES,
  type PortSide,
  cubicEdgePath,
  findNodeAtWorld,
  nodeBox,
  portAnchor,
  resolveArtifactSize,
  wirePreviewPath,
} from '../../core/utils/edge-path';
import { formatRefreshInterval } from '../../core/utils/auto-refresh';
import {
  groupFrameRect,
  groupGridCols,
  groupMemberCountLabel,
} from '../../core/utils/node-group';
import {
  buildGroupEdgeVisuals,
  type GroupEdgeVisual,
} from '../../core/utils/group-edge-visual';
import { loadWorkspace, safeLocalStorage, saveWorkspace } from '../../core/utils/workspace-persist';
import {
  CHAT_DRAG_MIME,
  parseChatDragPayload,
} from '../../core/utils/chat-to-node';
import type { NodeGroup } from '../../core/models/graph.model';

type DragState =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string; offsetX: number; offsetY: number }
  | {
      kind: 'group';
      groupId: string;
      lastX: number;
      lastY: number;
    }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | {
      kind: 'resize';
      nodeId: string;
      startW: number;
      startH: number;
      startX: number;
      startY: number;
    }
  | {
      kind: 'wire';
      fromNodeId: string;
      fromSide: PortSide;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

@Component({
  selector: 'app-graph-canvas',
  imports: [NodeChatBubbleComponent, NodeViewRenderComponent],
  templateUrl: './graph-canvas.component.html',
  styleUrl: './graph-canvas.component.scss',
})
export class GraphCanvasComponent implements OnDestroy {
  @ViewChild('canvasEl') canvasEl!: ElementRef<HTMLElement>;

  protected readonly graphService = inject(GraphService);
  protected readonly runtime = inject(RuntimeService);
  protected readonly repoGit = inject(RepoGitService);
  protected readonly settings = inject(SettingsService);
  protected readonly viewRefresh = inject(ViewRefreshService);

  protected readonly cwdRepoId = computed(() => resolveConnectedRepos(this.graphService.graph()).nodes[0]?.id);

  protected readonly diffOpen = signal<{ file: string; patch: string } | null>(null);
  protected readonly diffError = signal('');

  /** ПКМ-меню ноды (координаты относительно canvas). */
  protected readonly nodeMenu = signal<{ nodeId: string; x: number; y: number } | null>(
    null,
  );

  protected readonly menuPipes = computed(() =>
    listPipeSkills(this.graphService.graph()),
  );

  protected repoBadge(nodeId: string): string {
    const st = this.repoGit.statusFor(nodeId);
    if (!st) return '…';
    if (st.error) return '!';
    const n = st.totals.changed;
    return n === 0 ? 'clean' : `${n}`;
  }

  refreshRepo(nodeId: string): void {
    void this.repoGit.refreshNode(nodeId);
  }

  async openRepoDiff(nodeId: string, file: string): Promise<void> {
    const node = this.nodes().find((n) => n.id === nodeId);
    if (!node || !isArtifactData(node.data) || !node.data.repoPath) return;
    this.diffError.set('');
    try {
      const result = await this.repoGit.fetchDiff(node.data.repoPath, file);
      this.diffOpen.set(result);
    } catch (e) {
      this.diffError.set(e instanceof Error ? e.message : String(e));
      this.diffOpen.set({ file, patch: '' });
    }
  }

  closeDiff(): void {
    this.diffOpen.set(null);
    this.diffError.set('');
  }
  protected readonly runnerLabels = RUNNER_LABELS;
  protected readonly godPrimaryId = GOD_NODE_ID;
  protected readonly godW = GOD_NODE_W;
  protected readonly godH = GOD_NODE_H;
  protected readonly portSides = PORT_SIDES;

  artifactSize(node: GraphNode): { w: number; h: number } {
    if (node.type !== 'artifact' || !isArtifactData(node.data)) {
      return { w: GOD_NODE_W, h: GOD_NODE_H };
    }
    return resolveArtifactSize(node.data);
  }

  protected readonly pan = signal({ x: 0, y: 0 });
  protected readonly zoom = signal(1);
  protected readonly wireHoverTargetId = signal<string | null>(null);
  protected readonly wirePreview = signal<string | null>(null);

  protected readonly nodes = computed(() => this.graphService.graph().nodes);
  protected readonly edges = computed(() => this.graphService.graph().edges);
  protected readonly groups = computed(() => this.graphService.graph().groups ?? []);
  protected readonly edgeVisuals = computed(() =>
    buildGroupEdgeVisuals(this.edges(), this.nodes(), this.groups()),
  );
  protected readonly selectedId = computed(() => this.graphService.selectedNodeId());

  protected visualEdgeFlowing(v: GroupEdgeVisual): boolean {
    return v.edgeIds.some((id) => this.runtime.isEdgeFlowing(id));
  }

  protected visualEdgeInContext(v: GroupEdgeVisual): boolean {
    return v.edgeIds.some((id) => this.runtime.isEdgeInContext(id));
  }

  protected visualEdgeConnecting(v: GroupEdgeVisual): boolean {
    return v.edgeIds.some((id) => this.graphService.isEdgeConnecting(id));
  }

  onVisualEdgePointerDown(event: PointerEvent, v: GroupEdgeVisual): void {
    event.stopPropagation();
    event.preventDefault();
    this.suppressNextClick = true;
    // Сносим все схлопнутые линки к той же паре эндпоинтов
    for (const id of v.edgeIds) {
      this.graphService.removeEdge(id);
    }
  }

  protected readonly groupMemberCountLabel = groupMemberCountLabel;

  protected groupScreenBox(group: NodeGroup): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    const cols = groupGridCols(group.memberIds.length);
    const rect = groupFrameRect(group.position, group.memberIds.length, cols);
    const z = this.zoom();
    const p = this.pan();
    return {
      left: rect.x * z + p.x,
      top: rect.y * z + p.y,
      width: rect.w * z,
      height: rect.h * z,
    };
  }

  /** Размер холста (без сайдбара) — для clamp бабла настроек. */
  protected readonly canvasSize = signal({ w: 0, h: 0 });

  protected readonly chatBubblePos = computed(() => {
    const id = this.selectedId();
    if (!id || !this.graphService.settingsOpen()) return null;
    const node = this.nodes().find((n) => n.id === id);
    if (!node) return null;
    const width = node.type === 'god' ? GOD_NODE_W : this.artifactSize(node).w;
    const vp = this.canvasSize();
    return nodeChatBubblePosition(node.position, this.pan(), this.zoom(), width, {
      viewport: vp.w > 0 && vp.h > 0 ? vp : undefined,
      bubbleWidth: NODE_CHAT_BUBBLE_WIDTH,
    });
  });

  private drag: DragState = { kind: 'none' };
  private pointerOrigin = { x: 0, y: 0 };
  private suppressNextClick = false;
  private revealedId: string | null = null;
  private canvasResizeObs: ResizeObserver | null = null;

  private readonly onMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onUp = (e: PointerEvent) => this.handleUp(e);
  private readonly onSelectStart = (e: Event) => {
    if (this.drag.kind !== 'none') e.preventDefault();
  };
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.closeNodeMenu();
  };

  constructor() {
    const snap = loadWorkspace(safeLocalStorage());
    if (snap?.pan) this.pan.set(snap.pan);
    if (typeof snap?.zoom === 'number') this.zoom.set(snap.zoom);
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('selectstart', this.onSelectStart);
    document.addEventListener('keydown', this.onKeyDown);

    afterRenderEffect(() => {
      const id = this.selectedId();
      if (!id || id === this.revealedId) return;
      this.revealedId = id;
      this.revealSelected(id);
    });

    afterRenderEffect(() => {
      const el = this.canvasEl?.nativeElement;
      if (!el || this.canvasResizeObs) return;
      const sync = () => {
        this.canvasSize.set({ w: el.clientWidth, h: el.clientHeight });
      };
      sync();
      this.canvasResizeObs = new ResizeObserver(sync);
      this.canvasResizeObs.observe(el);
    });

    effect(() => {
      const repoIds = this.graphService
        .graph()
        .nodes.filter(
          (n) => n.type === 'artifact' && isArtifactData(n.data) && n.data.kind === 'repo',
        )
        .map((n) => {
          const path = isArtifactData(n.data) ? n.data.repoPath ?? '' : '';
          return `${n.id}:${path}`;
        })
        .join('|');
      void repoIds;
      for (const n of this.graphService.graph().nodes) {
        if (n.type === 'artifact' && isArtifactData(n.data) && n.data.kind === 'repo') {
          void this.repoGit.refreshNode(n.id);
        }
      }
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('selectstart', this.onSelectStart);
    document.removeEventListener('keydown', this.onKeyDown);
    this.canvasResizeObs?.disconnect();
    this.canvasResizeObs = null;
    this.endDrag();
  }

  closeNodeMenu(): void {
    this.nodeMenu.set(null);
  }

  onNodeContextMenu(event: MouseEvent, nodeId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.canvasEl.nativeElement.getBoundingClientRect();
    this.nodeMenu.set({
      nodeId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  menuCanDelete(): boolean {
    const id = this.nodeMenu()?.nodeId;
    if (!id || isPrimaryGod(id)) return false;
    const node = this.nodes().find((n) => n.id === id);
    return !!node && (node.type === 'artifact' || node.type === 'god');
  }

  menuCanSelectGroup(): boolean {
    const id = this.nodeMenu()?.nodeId;
    if (!id) return false;
    const g = this.graphService.groupOf(id);
    return !!g && g.memberIds.length >= 2;
  }

  menuCanUngroup(): boolean {
    return this.menuCanSelectGroup();
  }

  menuOpenSettings(): void {
    const id = this.nodeMenu()?.nodeId;
    this.closeNodeMenu();
    if (id) this.openSettings(id);
  }

  menuSelectGroup(): void {
    const id = this.nodeMenu()?.nodeId;
    this.closeNodeMenu();
    if (id) this.graphService.selectGroupOf(id);
  }

  menuUngroup(): void {
    const id = this.nodeMenu()?.nodeId;
    this.closeNodeMenu();
    if (!id) return;
    const g = this.graphService.groupOf(id);
    if (g) this.graphService.ungroup(g.id);
  }

  menuDelete(): void {
    const id = this.nodeMenu()?.nodeId;
    this.closeNodeMenu();
    if (!id || isPrimaryGod(id)) return;
    this.graphService.removeArtifactNode(id);
  }

  menuRunPipe(pipeId: string): void {
    const id = this.nodeMenu()?.nodeId;
    this.closeNodeMenu();
    if (!id) return;
    void this.runtime.runPipe(id, pipeId);
  }

  protected transform(): string {
    const { x, y } = this.pan();
    const z = this.zoom();
    return `translate(${x}, ${y}) scale(${z})`;
  }

  protected auraBox(node: GraphNode): { left: number; top: number; width: number; height: number } {
    return nodeAuraBox(node.position, this.artifactSize(node), this.pan(), this.zoom());
  }

  protected grid() {
    return gridPattern(this.pan(), this.zoom());
  }

  private toWorld(event: PointerEvent | DragEvent): { x: number; y: number } {
    const rect = this.canvasEl.nativeElement.getBoundingClientRect();
    const z = this.zoom();
    const p = this.pan();
    return {
      x: (event.clientX - rect.left - p.x) / z,
      y: (event.clientY - rect.top - p.y) / z,
    };
  }

  private hasChatDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    const list = Array.from(types);
    return list.includes(CHAT_DRAG_MIME) || list.includes('text/plain');
  }

  onChatDragOver(event: DragEvent): void {
    if (!this.hasChatDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  onChatDrop(event: DragEvent): void {
    if (!this.hasChatDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const raw =
      event.dataTransfer?.getData(CHAT_DRAG_MIME) ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    const payload = parseChatDragPayload(raw);
    if (!payload) return;
    const world = this.toWorld(event);
    this.graphService.spawnArtifactFromChatThread(
      payload.sourceNodeId,
      payload.threadId,
      world,
    );
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.closeNodeMenu();
    if (!event.ctrlKey && !event.metaKey) {
      this.graphService.clearMultiSelect();
    }
    this.beginDrag();
    const p = this.pan();
    this.pointerOrigin = { x: event.clientX, y: event.clientY };
    this.drag = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      panX: p.x,
      panY: p.y,
    };
  }

  onGroupPointerDown(event: PointerEvent, group: NodeGroup): void {
    event.stopPropagation();
    if (event.button !== 0) return;
    this.beginDrag();
    const world = this.toWorld(event);
    this.pointerOrigin = { x: event.clientX, y: event.clientY };
    this.drag = {
      kind: 'group',
      groupId: group.id,
      lastX: world.x,
      lastY: world.y,
    };
  }

  ungroupClick(event: Event, groupId: string): void {
    event.stopPropagation();
    event.preventDefault();
    this.graphService.ungroup(groupId);
  }

  onNodePointerDown(event: PointerEvent, node: GraphNode): void {
    event.stopPropagation();
    if (this.graphService.linkingFromId()) {
      this.graphService.completeLink(node.id);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.graphService.toggleNodeMultiSelect(node.id);
      return;
    }

    this.beginDrag();

    const world = this.toWorld(event);
    this.pointerOrigin = { x: event.clientX, y: event.clientY };
    const group = this.graphService.groupOf(node.id);
    if (group) {
      this.drag = {
        kind: 'group',
        groupId: group.id,
        lastX: world.x,
        lastY: world.y,
      };
    } else {
      this.drag = {
        kind: 'node',
        nodeId: node.id,
        offsetX: world.x - node.position.x,
        offsetY: world.y - node.position.y,
      };
    }
    this.graphService.selectNode(node.id);
  }

  onPortPointerDown(event: PointerEvent, node: GraphNode, side: PortSide): void {
    event.stopPropagation();
    event.preventDefault();
    this.beginDrag();
    const box = nodeBox(node);
    const port = portAnchor(box, side);
    this.pointerOrigin = { x: event.clientX, y: event.clientY };
    this.drag = {
      kind: 'wire',
      fromNodeId: node.id,
      fromSide: side,
      x1: port.x,
      y1: port.y,
      x2: port.x,
      y2: port.y,
    };
    this.wirePreview.set(wirePreviewPath(port.x, port.y, port.x, port.y));
    this.wireHoverTargetId.set(null);
    this.graphService.selectNode(node.id);
    this.canvasEl?.nativeElement.classList.add('is-wiring');
  }

  onResizePointerDown(event: PointerEvent, node: GraphNode): void {
    event.stopPropagation();
    if (node.type !== 'artifact' || !isArtifactData(node.data)) return;
    this.beginDrag();
    const size = resolveArtifactSize(node.data);
    this.pointerOrigin = { x: event.clientX, y: event.clientY };
    this.drag = {
      kind: 'resize',
      nodeId: node.id,
      startW: size.w,
      startH: size.h,
      startX: event.clientX,
      startY: event.clientY,
    };
    this.graphService.selectNode(node.id);
  }

  onEdgePointerDown(event: PointerEvent, edge: GraphEdge): void {
    event.stopPropagation();
    event.preventDefault();
    this.suppressNextClick = true;
    this.graphService.removeEdge(edge.id);
  }

  private handleMove(event: PointerEvent): void {
    const d = this.drag;
    if (d.kind === 'none') return;

    if (d.kind === 'pan') {
      this.pan.set({
        x: d.panX + (event.clientX - d.startX),
        y: d.panY + (event.clientY - d.startY),
      });
      return;
    }

    if (d.kind === 'resize') {
      const z = this.zoom();
      this.graphService.setNodeSize(d.nodeId, {
        w: d.startW + (event.clientX - d.startX) / z,
        h: d.startH + (event.clientY - d.startY) / z,
      });
      return;
    }

    if (d.kind === 'wire') {
      const world = this.toWorld(event);
      d.x2 = world.x;
      d.y2 = world.y;
      this.wirePreview.set(wirePreviewPath(d.x1, d.y1, d.x2, d.y2));
      const hit = findNodeAtWorld(this.nodes(), world.x, world.y, d.fromNodeId);
      this.wireHoverTargetId.set(hit?.id ?? null);
      return;
    }

    if (d.kind === 'group') {
      const world = this.toWorld(event);
      const dx = world.x - d.lastX;
      const dy = world.y - d.lastY;
      d.lastX = world.x;
      d.lastY = world.y;
      this.graphService.moveGroupBy(d.groupId, dx, dy);
      return;
    }

    const world = this.toWorld(event);
    this.graphService.updateNodePosition(d.nodeId, {
      x: world.x - d.offsetX,
      y: world.y - d.offsetY,
    });
  }

  private handleUp(event: PointerEvent): void {
    const d = this.drag;
    const wasPan = d.kind === 'pan';
    const wasWire = d.kind === 'wire';

    if (wasWire) {
      const world = this.toWorld(event);
      const hit = findNodeAtWorld(this.nodes(), world.x, world.y, d.fromNodeId);
      if (hit) {
        // Уже связаны → отвязать; иначе связать
        this.graphService.toggleLink(d.fromNodeId, hit.id);
      }
      this.wirePreview.set(null);
      this.wireHoverTargetId.set(null);
      this.canvasEl?.nativeElement.classList.remove('is-wiring');
    }

    if (
      d.kind !== 'none' &&
      !isStationaryClick(this.pointerOrigin, { x: event.clientX, y: event.clientY })
    ) {
      this.suppressNextClick = true;
    }
    this.drag = { kind: 'none' };
    this.endDrag();
    if (wasPan) this.persistView();
  }

  private beginDrag(): void {
    window.getSelection()?.removeAllRanges();
    this.canvasEl?.nativeElement.classList.add('is-dragging');
    document.body.classList.add('graph-dragging');
  }

  private endDrag(): void {
    this.canvasEl?.nativeElement.classList.remove('is-dragging');
    document.body.classList.remove('graph-dragging');
  }

  selectNode(nodeId: string): void {
    this.graphService.selectNode(nodeId);
  }

  /** Обычный click; Ctrl/Cmd уже обработан в pointerdown — не сбрасывать multi-select. */
  onNodeClick(event: MouseEvent, nodeId: string): void {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) return;
    this.graphService.selectNode(nodeId);
  }

  openSettings(nodeId: string): void {
    this.graphService.openSettings(nodeId);
  }

  onCanvasClick(): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    this.closeNodeMenu();
    this.graphService.cancelLink();
    this.graphService.selectNode(null);
    this.graphService.dismissSettings();
  }

  edgePath(source: GraphNode, target: GraphNode): string {
    return cubicEdgePath(source, target);
  }

  asArtifact(data: GraphNode['data']): ArtifactNodeData {
    return data as ArtifactNodeData;
  }

  refreshLabel(intervalMs: number): string {
    return formatRefreshInterval(intervalMs);
  }

  cronHint(nodeId: string, intervalMs: number): string {
    return this.viewRefresh.nextRefreshHint(nodeId, intervalMs);
  }

  forceCronRefresh(nodeId: string): void {
    void this.viewRefresh.forceRefresh(nodeId);
  }

  asGod(data: GraphNode['data']): GodNodeData {
    return normalizeGodData(data);
  }

  isArtifact(node: GraphNode): boolean {
    return node.type === 'artifact' && isArtifactData(node.data);
  }

  zoomIn(): void {
    this.zoom.update((z) => Math.min(z + 0.1, 2));
    this.persistView();
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(z - 0.1, 0.3));
    this.persistView();
  }

  resetView(): void {
    this.pan.set({ x: 0, y: 0 });
    this.zoom.set(1);
    this.persistView();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.canvasEl.nativeElement.getBoundingClientRect();
    // Мягкий зум: line (колёсико) ~0.025/щелчок; pixel (трекпад) — пропорционально
    const scale = event.deltaMode === 1 ? 0.025 : 0.001;
    const delta = Math.max(-0.04, Math.min(0.04, -event.deltaY * scale));
    if (!delta) return;
    const next = zoomAtCursor({
      pan: this.pan(),
      zoom: this.zoom(),
      cursor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      delta,
    });
    this.zoom.set(next.zoom);
    this.pan.set(next.pan);
    this.persistView();
  }

  private persistView(): void {
    saveWorkspace(safeLocalStorage(), {
      pan: this.pan(),
      zoom: this.zoom(),
    });
  }

  private revealSelected(id: string): void {
    const el = this.canvasEl?.nativeElement;
    const node = this.nodes().find((n) => n.id === id);
    if (!el || !node) return;
    const size =
      node.type === 'god' ? { w: GOD_NODE_W, h: GOD_NODE_H } : this.artifactSize(node);
    const next = panToRevealNode({
      node: { x: node.position.x, y: node.position.y, ...size },
      pan: this.pan(),
      zoom: this.zoom(),
      canvas: { w: el.clientWidth, h: el.clientHeight },
    });
    if (!next) return;
    this.pan.set(next);
    this.persistView();
  }

  modelLabel(model: string | undefined): string {
    return displayModelName(model);
  }
}
