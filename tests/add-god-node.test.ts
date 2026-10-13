import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID, isGodData } from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';

describe('GraphService.addGodNode', () => {
  it('создаёт саб-GOD с openai-compatible и выбирает его', () => {
    const svc = new GraphService();
    const id = svc.addGodNode({
      label: 'DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(id).toMatch(/^god-\d+$/);
    const node = svc.graph().nodes.find((n) => n.id === id);
    expect(node?.type).toBe('god');
    expect(isGodData(node!.data) && node!.data.label).toBe('DeepSeek');
    expect(isGodData(node!.data) && node!.data.runner).toBe('openai-compatible');
    expect(svc.selectedNodeId()).toBe(id);
    expect(svc.settingsOpen()).toBe(false);
  });

  it('linkToPrimary=true соединяет с cursor-god', () => {
    const svc = new GraphService();
    const id = svc.addGodNode({ label: 'Corp' }, { linkToPrimary: true });
    expect(svc.isLinked(GOD_NODE_ID, id)).toBe(true);
  });

  it('updateGodConfig патчит указанный god', () => {
    const svc = new GraphService();
    const id = svc.addGodNode({ label: 'A' });
    svc.updateGodConfig({ model: 'm1' }, id);
    svc.updateGodConfig({ model: 'primary-m' });
    const sub = svc.graph().nodes.find((n) => n.id === id);
    const primary = svc.graph().nodes.find((n) => n.id === GOD_NODE_ID);
    expect(isGodData(sub!.data) && sub!.data.model).toBe('m1');
    expect(isGodData(primary!.data) && primary!.data.model).toBe('primary-m');
  });

  it('можно удалить саб-GOD, primary — нет', () => {
    const svc = new GraphService();
    const id = svc.addGodNode({ label: 'Temp' });
    svc.removeArtifactNode(GOD_NODE_ID);
    expect(svc.graph().nodes.some((n) => n.id === GOD_NODE_ID)).toBe(true);
    svc.removeArtifactNode(id);
    expect(svc.graph().nodes.some((n) => n.id === id)).toBe(false);
  });
});
