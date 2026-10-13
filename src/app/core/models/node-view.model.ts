export interface ViewListItem {
  text: string;
  href?: string;
  meta?: string;
}

export interface ViewKvRow {
  key: string;
  value: string;
  href?: string;
}

export interface ViewChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  href?: string;
}

export type ViewSpec =
  | { type: 'list'; title?: string; items: ViewListItem[] }
  | { type: 'kv'; title?: string; rows: ViewKvRow[] }
  | { type: 'markdown'; title?: string; body: string }
  | { type: 'checklist'; title?: string; items: ViewChecklistItem[] };

export const VIEW_PREVIEW_LIMIT = 3;
export const VIEW_MAX_ITEMS = 50;
