import { describe, expect, it } from 'vitest';
import { GOD_NODE_ID, isGodData } from '../src/app/core/models/graph.model';
import { GraphService } from '../src/app/core/services/graph.service';
import { parseGodSpawnSpec, wantsSubGodPrompt } from '../src/app/core/utils/god-delegate';

describe('applyGodSpawn на черновике artifact', () => {
  it('промоутит «Новая нода» в саб-GOD с baseUrl/model', () => {
    const svc = new GraphService();
    const draftId = svc.addArtifactNode();
    const pos = svc.graph().nodes.find((n) => n.id === draftId)!.position;

    const godId = svc.applyGodSpawn(draftId, {
      label: 'OpenWebUI',
      runner: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://openwebui.example.com/api/v1',
      apiKey: 'from-secret',
      linkToPrimary: true,
    });

    expect(godId).toMatch(/^god-/);
    expect(svc.graph().nodes.some((n) => n.id === draftId)).toBe(false);
    const god = svc.graph().nodes.find((n) => n.id === godId);
    expect(god?.type).toBe('god');
    expect(god?.position).toEqual(pos);
    expect(isGodData(god!.data) && god!.data.baseUrl).toBe(
      'https://openwebui.example.com/api/v1',
    );
    expect(isGodData(god!.data) && god!.data.apiKey).toBe('from-secret');
    expect(isGodData(god!.data) && god!.data.model).toBe('deepseek-chat');
    expect(svc.isLinked(GOD_NODE_ID, godId!)).toBe(true);
    expect(svc.selectedNodeId()).toBe(godId);
  });
});

describe('parseGodSpawnSpec apiKeyEnv', () => {
  it('читает apiKeyEnv', () => {
    expect(
      parseGodSpawnSpec({
        label: 'OW',
        baseUrl: 'https://x/v1',
        apiKeyEnv: 'OPEN_WEBUI_TOKEN',
      }),
    ).toMatchObject({ apiKeyEnv: 'OPEN_WEBUI_TOKEN' });
  });
});

describe('wantsSubGodPrompt openwebui', () => {
  it('ложит openwebui / openai-compatible endpoint', () => {
    expect(wantsSubGodPrompt('подключи OpenWebUI https://openwebui.test/api/v1')).toBe(true);
    expect(wantsSubGodPrompt('openai-compatible base url для deepseek')).toBe(true);
  });
});
