import { Inject, Injectable, Optional, signal } from '@angular/core';
import { WORKSPACE_STORAGE } from './graph.service';
import { loadWorkspace, safeLocalStorage, saveWorkspace, type StorageLike } from '../utils/workspace-persist';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly open = signal(false);
  readonly boardAuraEnabled = signal(true);

  private readonly storage: StorageLike | null;

  constructor(@Optional() @Inject(WORKSPACE_STORAGE) storage: StorageLike | null = null) {
    this.storage = storage ?? safeLocalStorage();
    const snap = loadWorkspace(this.storage);
    if (typeof snap?.boardAuraEnabled === 'boolean') {
      this.boardAuraEnabled.set(snap.boardAuraEnabled);
    }
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  setBoardAuraEnabled(enabled: boolean): void {
    this.boardAuraEnabled.set(enabled);
    saveWorkspace(this.storage, { boardAuraEnabled: enabled });
  }
}
