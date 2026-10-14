import { describe, expect, it } from 'vitest';
import { SettingsService } from '../src/app/core/services/settings.service';
import {
  loadWorkspace,
  saveWorkspace,
  type StorageLike,
} from '../src/app/core/utils/workspace-persist';
import { GOD_NODE_ID } from '../src/app/core/models/graph.model';

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('SettingsService', () => {
  it('по умолчанию блюр включён, выключение пишется в workspace', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
      boardAuraEnabled: true,
    });

    const svc = new SettingsService(storage);
    expect(svc.boardAuraEnabled()).toBe(true);

    svc.setBoardAuraEnabled(false);
    expect(svc.boardAuraEnabled()).toBe(false);
    expect(loadWorkspace(storage)?.boardAuraEnabled).toBe(false);
  });

  it('подхватывает boardAuraEnabled: false из storage', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
      boardAuraEnabled: false,
    });
    const svc = new SettingsService(storage);
    expect(svc.boardAuraEnabled()).toBe(false);
  });

  it('по умолчанию звук завершения включён, выключение пишется в workspace', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
    });

    const svc = new SettingsService(storage);
    expect(svc.completionSoundEnabled()).toBe(true);

    svc.setCompletionSoundEnabled(false);
    expect(svc.completionSoundEnabled()).toBe(false);
    expect(loadWorkspace(storage)?.completionSoundEnabled).toBe(false);
  });

  it('подхватывает completionSoundEnabled: false из storage', () => {
    const storage = memoryStorage();
    saveWorkspace(storage, {
      selectedNodeId: GOD_NODE_ID,
      nodeChats: {},
      completionSoundEnabled: false,
    });
    const svc = new SettingsService(storage);
    expect(svc.completionSoundEnabled()).toBe(false);
  });
});
