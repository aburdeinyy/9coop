import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { ViewSpec } from '../../core/models/node-view.model';
import { VIEW_MAX_ITEMS } from '../../core/models/node-view.model';
import { viewPreviewItems } from '../../core/utils/node-view';
import type { ViewListItem } from '../../core/models/node-view.model';
import {
  parseViewListStatus,
  viewListStatusIcon,
  viewListStatusTone,
  withoutPipelineSummaryItems,
  type ViewListStatusTone,
} from '../../core/utils/view-list-status';

@Component({
  selector: 'app-node-view-render',
  templateUrl: './node-view-render.component.html',
  styleUrl: './node-view-render.component.scss',
})
export class NodeViewRenderComponent {
  @Input({ required: true }) view!: ViewSpec;
  /** compact = canvas preview; full = bubble */
  @Input() mode: 'compact' | 'full' = 'full';
  /** Высота artifact-ноды (world px) — оставлено для совместимости; список скроллится целиком. */
  @Input() nodeHeight?: number;
  @Output() readonly toggleItem = new EventEmitter<string>();
  @Output() readonly addItem = new EventEmitter<string>();
  @Output() readonly removeItem = new EventEmitter<string>();

  draft = '';

  preview() {
    return viewPreviewItems(this.view, VIEW_MAX_ITEMS);
  }

  statusIcon(meta?: string | null): string | null {
    const s = parseViewListStatus(meta);
    return s ? viewListStatusIcon(s) : null;
  }

  statusTone(meta?: string | null): ViewListStatusTone | null {
    const s = parseViewListStatus(meta);
    return s ? viewListStatusTone(s) : null;
  }

  statusTitle(meta?: string | null): string {
    return meta?.trim() || '';
  }

  /** Без строки pipeline #N (уже сохранённые view тоже). */
  listItems(): ViewListItem[] {
    if (this.view.type !== 'list') return [];
    return withoutPipelineSummaryItems(this.view.items);
  }

  onToggle(itemId: string | undefined, event: Event): void {
    event.stopPropagation();
    if (!itemId) return;
    this.toggleItem.emit(itemId);
  }

  onDraft(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
  }

  submitAdd(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const text = this.draft.trim();
    if (!text) return;
    this.addItem.emit(text);
    this.draft = '';
  }

  onRemove(itemId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.removeItem.emit(itemId);
  }
}
