import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ToolbarComponent } from './features/toolbar/toolbar.component';
import { GraphCanvasComponent } from './features/graph-canvas/graph-canvas.component';
import { GlobalChatComponent } from './features/global-chat/global-chat.component';
import { SecretsPanelComponent } from './features/secrets-panel/secrets-panel.component';
import { SettingsPanelComponent } from './features/settings-panel/settings-panel.component';
import {
  SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth,
} from './core/utils/sidebar-width';
import { loadWorkspace, safeLocalStorage, saveWorkspace } from './core/utils/workspace-persist';
import { ViewRefreshService } from './core/services/view-refresh.service';
import { GraphService } from './core/services/graph.service';
import { isArtifactData } from './core/models/graph.model';

@Component({
  selector: 'app-root',
  imports: [
    ToolbarComponent,
    GraphCanvasComponent,
    GlobalChatComponent,
    SecretsPanelComponent,
    SettingsPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private readonly viewRefresh = inject(ViewRefreshService);
  private readonly graphService = inject(GraphService);
  protected readonly sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);
  protected readonly resizing = signal(false);

  /** Скрыт вручную, либо repo-нода (чат справа не нужен). */
  protected readonly hideChatSidebar = computed(() => {
    if (!this.graphService.chatSidebarOpen()) return true;
    const id = this.graphService.selectedNodeId();
    if (!id) return false;
    const node = this.graphService.graph().nodes.find((n) => n.id === id);
    return (
      !!node &&
      node.type === 'artifact' &&
      isArtifactData(node.data) &&
      node.data.kind === 'repo'
    );
  });

  private resize: { startX: number; startWidth: number } | null = null;

  private readonly onMove = (e: PointerEvent) => this.handleResizeMove(e);
  private readonly onUp = () => this.handleResizeUp();

  constructor() {
    this.viewRefresh.start();
    const snap = loadWorkspace(safeLocalStorage());
    if (typeof snap?.sidebarWidth === 'number') {
      this.sidebarWidth.set(clampSidebarWidth(snap.sidebarWidth, window.innerWidth));
    }
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
  }

  ngOnDestroy(): void {
    this.viewRefresh.stop();
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
  }

  onResizeStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.resize = { startX: event.clientX, startWidth: this.sidebarWidth() };
    this.resizing.set(true);
  }

  private handleResizeMove(event: PointerEvent): void {
    if (!this.resize) return;
    const next = this.resize.startWidth + (this.resize.startX - event.clientX);
    this.sidebarWidth.set(clampSidebarWidth(next, window.innerWidth));
  }

  private handleResizeUp(): void {
    if (!this.resize) return;
    this.resize = null;
    this.resizing.set(false);
    saveWorkspace(safeLocalStorage(), { sidebarWidth: this.sidebarWidth() });
  }
}
