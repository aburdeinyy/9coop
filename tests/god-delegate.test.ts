import { describe, expect, it } from 'vitest';
import {
  extractLayercoopDelegate,
  extractLayercoopGod,
  parseDelegateSpec,
  parseGodSpawnSpec,
  stripLayercoopDelegateFence,
  stripLayercoopGodFence,
} from '../src/app/core/utils/god-delegate';

describe('layercoop-delegate', () => {
  it('parseDelegateSpec требует targetId и task', () => {
    expect(parseDelegateSpec({ targetId: 'god-2', task: 'get jira' })).toEqual({
      targetId: 'god-2',
      task: 'get jira',
    });
    expect(parseDelegateSpec({ targetId: '', task: 'x' })).toBeNull();
    expect(parseDelegateSpec({ targetId: 'god-2', task: '  ' })).toBeNull();
  });

  it('extract + strip fence', () => {
    const reply = `План:\n\`\`\`layercoop-delegate\n{"targetId":"god-2","task":"Список задач из Jira"}\n\`\`\`\nЖду результат.`;
    expect(extractLayercoopDelegate(reply)).toEqual({
      targetId: 'god-2',
      task: 'Список задач из Jira',
    });
    expect(stripLayercoopDelegateFence(reply)).toBe('План:\n\nЖду результат.');
  });
});

describe('layercoop-god spawn', () => {
  it('parseGodSpawnSpec', () => {
    expect(
      parseGodSpawnSpec({
        label: 'DeepSeek',
        runner: 'openai-compatible',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        linkToPrimary: true,
      }),
    ).toEqual({
      label: 'DeepSeek',
      runner: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      linkToPrimary: true,
    });
    expect(parseGodSpawnSpec({})).toBeNull();
  });

  it('extract + strip', () => {
    const reply = `Ок.\n\`\`\`layercoop-god\n{"label":"Corp","baseUrl":"https://llm.corp/v1","linkToPrimary":true}\n\`\`\``;
    expect(extractLayercoopGod(reply)?.label).toBe('Corp');
    expect(stripLayercoopGodFence(reply)).toBe('Ок.');
  });
});
