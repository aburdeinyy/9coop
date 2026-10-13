import { describe, expect, it, vi } from 'vitest';
import { GOD_NODE_ID, defaultGodData, normalizeGodData } from '../src/app/core/models/graph.model';
import {
  RUNNER_PRESETS,
  bridgeBase,
  buildBridgeRunBody,
  completeBridgeRun,
  cursorModelLabel,
  cursorModelOptions,
  cursorEffortParam,
  cursorFastParam,
  isLocalRunner,
  localRunnerFor,
  displayModelName,
  parseCursorModelSelection,
  parseCursorModelsList,
  requiresApiKey,
  resolveCursorModelId,
  selectCursorModel,
  setCursorModelParam,
} from '../src/app/core/runtime/llm-provider';
import { DEFAULT_OPENCODE_BASE_URL } from '../src/app/core/runtime/local-runners';
import type { ChatContext } from '../src/app/core/utils/compose-context';

function contextFor(patch: Partial<ReturnType<typeof defaultGodData>>): ChatContext {
  return {
    systemPrompt: 'system',
    userPrompt: 'привет',
    connectedArtifacts: [],
    god: { ...defaultGodData(), ...patch },
    focusNodeId: GOD_NODE_ID,
  };
}

describe('runners через bridge', () => {
  it('local-раннеры идут через bridge, HTTP-runners — нет', () => {
    expect(isLocalRunner('cursor')).toBe(true);
    expect(isLocalRunner('claude-code')).toBe(true);
    expect(isLocalRunner('opencode')).toBe(true);
    expect(isLocalRunner('openai')).toBe(false);
    expect(isLocalRunner('openai-compatible')).toBe(false);
  });

  it('RunnerId маппится на local bridge runner', () => {
    expect(localRunnerFor('claude-code')).toBe('claude-code');
    expect(localRunnerFor('opencode')).toBe('opencode');
    expect(localRunnerFor('cursor')).toBe('cursor');
    expect(localRunnerFor('openai')).toBeUndefined();
  });

  it('ключ обязателен только для Cursor: Claude Code берёт подписку', () => {
    expect(requiresApiKey('cursor')).toBe(true);
    expect(requiresApiKey('claude-code')).toBe(false);
    expect(requiresApiKey('opencode')).toBe(false);
  });

  it('пресет Anthropic обновлён на актуальную модель', () => {
    expect(RUNNER_PRESETS.anthropic.model).toBe('claude-opus-5');
    expect(RUNNER_PRESETS['claude-code'].model).toBe('claude-opus-5');
    expect(RUNNER_PRESETS.opencode.baseUrl).toBe(DEFAULT_OPENCODE_BASE_URL);
  });

  it('для opencode baseUrl — адрес его сервера, а не bridge', () => {
    const god = { ...defaultGodData(), runner: 'opencode' as const, baseUrl: 'http://127.0.0.1:4096' };
    expect(bridgeBase(god)).toBe('/layercoop-bridge');
  });

  it('claude-code: в тело рана попадает runner и флаг изоляции', () => {
    const god = { ...defaultGodData(), runner: 'claude-code' as const, model: 'claude-opus-5', isolated: true };
    const body = buildBridgeRunBody(god, contextFor(god));
    expect(body.runner).toBe('claude-code');
    expect(body).toMatchObject({ isolated: true, model: 'claude-opus-5' });
    expect(body).not.toHaveProperty('baseUrl');
  });

  it('opencode: в тело рана попадает адрес сервера, дефолт подставляется', () => {
    const god = { ...defaultGodData(), runner: 'opencode' as const, baseUrl: '' };
    const body = buildBridgeRunBody(god, contextFor(god));
    expect(body.runner).toBe('opencode');
    expect(body).toMatchObject({ baseUrl: DEFAULT_OPENCODE_BASE_URL });
    expect(body).not.toHaveProperty('isolated');
  });

  it('cursor: прежнее тело рана, дефолтная модель — auto', () => {
    const god = { ...defaultGodData(), runner: 'cursor' as const, model: '' };
    const body = buildBridgeRunBody(god, contextFor(god));
    expect(body).toMatchObject({ runner: 'cursor', model: 'auto' });
    expect(body).not.toHaveProperty('isolated');
  });

  it('cursor: auto уходит в bridge как auto, не подменяется на composer', () => {
    const god = { ...defaultGodData(), runner: 'cursor' as const, model: 'auto' };
    expect(buildBridgeRunBody(god, contextFor(god)).model).toBe('auto');
  });

  it('workspaceCwd из context попадает в body.cwd', () => {
    const god = defaultGodData();
    const body = buildBridgeRunBody(god, {
      ...contextFor(god),
      workspaceCwd: '/tmp/my-repo',
    });
    expect(body.cwd).toBe('/tmp/my-repo');
  });

  it('resolveCursorModelId: пусто → auto, живые id сохраняются', () => {
    expect(resolveCursorModelId('')).toBe('auto');
    expect(resolveCursorModelId('  ')).toBe('auto');
    expect(resolveCursorModelId('auto')).toBe('auto');
    expect(resolveCursorModelId('grok-4.6')).toBe('grok-4.6');
    expect(resolveCursorModelId('grok-4.6?thinking=high')).toBe('grok-4.6?thinking=high');
  });

  it('cursorModelOptions не подмешивает Auto, текущая не из каталога — впереди', () => {
    expect(cursorModelOptions()).toEqual([]);
    expect(cursorModelOptions('auto')).toEqual(['auto']);
    expect(cursorModelOptions('composer-2.5')).toEqual(['composer-2.5']);
    expect(
      cursorModelOptions('gpt-5.4', [
        { id: 'auto', label: 'Auto' },
        { id: 'grok-4.6', label: 'Grok 4.6' },
      ]),
    ).toEqual(['gpt-5.4', 'auto', 'grok-4.6']);
    expect(cursorModelLabel('auto')).toBe('Auto');
    expect(cursorModelLabel('grok-4.6')).toBe('grok-4.6');
  });

  it('displayModelName прячет query-параметры Cursor на карточке ноды', () => {
    expect(displayModelName('composer-2.5?effort=high&fast=true')).toBe('composer-2.5');
    expect(displayModelName('grok-4.6')).toBe('grok-4.6');
    expect(displayModelName('  ')).toBe('');
    expect(displayModelName(undefined)).toBe('');
  });

  it('parseCursorModelsList: уникальные модели + default params, без старых id', () => {
    const options = parseCursorModelsList({
      items: [
        {
          id: 'claude-haiku-4-5',
          displayName: 'Claude Haiku 4.5',
          parameters: [
            {
              id: 'thinking',
              values: [{ value: 'false' }, { value: 'true' }],
            },
          ],
          variants: [
            { displayName: 'Claude Haiku 4.5', params: [{ id: 'thinking', value: 'true' }], isDefault: true },
          ],
        },
        {
          id: 'grok-4.6',
          displayName: 'Grok 4.6',
          parameters: [
            {
              id: 'thinking',
              displayName: 'Effort',
              values: [
                { value: 'low', displayName: 'Low' },
                { value: 'high', displayName: 'High' },
              ],
            },
            {
              id: 'fast',
              displayName: 'Fast',
              values: [{ value: 'false' }, { value: 'true', displayName: 'Fast' }],
            },
          ],
          variants: [
            { displayName: 'Grok 4.6 Low', params: [{ id: 'thinking', value: 'low' }] },
            { displayName: 'Grok 4.6 High', params: [{ id: 'thinking', value: 'high' }], isDefault: true },
            {
              displayName: 'Grok 4.6 High Fast',
              params: [
                { id: 'thinking', value: 'high' },
                { id: 'fast', value: 'true' },
              ],
              isDefault: true,
            },
          ],
        },
        { id: 'auto-smart', displayName: 'Auto' },
        { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
      ],
    });
    expect(options.map((o) => o.id)).toEqual(['grok-4.6', 'auto-smart']);
    expect(options[0]).toMatchObject({
      id: 'grok-4.6',
      label: 'Grok 4.6',
      defaultParams: [{ id: 'thinking', value: 'high' }],
    });
    expect(cursorEffortParam(options[0]!)?.id).toBe('thinking');
    expect(cursorEffortParam(options[0]!)?.values.map((v) => v.value)).toEqual(['low', 'high']);
    expect(selectCursorModel('grok-4.6', '', options)).toBe('grok-4.6?thinking=high');
    expect(setCursorModelParam('grok-4.6?thinking=high', 'thinking', 'low')).toBe(
      'grok-4.6?thinking=low',
    );
  });

  it('parseCursorModelsList: плоский ответ bridge схлопывает варианты в id модели', () => {
    const options = parseCursorModelsList({
      models: [
        { id: 'default', label: 'Auto' },
        { id: 'grok-4.7?context=200k&reasoning=high', label: 'Grok 4.7 High' },
        { id: 'grok-4.7?context=200k&reasoning=high&fast=true', label: 'Grok 4.7 High Fast' },
        { id: 'claude-opus-5?thinking=true', label: 'Claude Opus 5 High' },
      ],
    });
    expect(options.map((o) => ({ id: o.id, label: o.label }))).toEqual([
      { id: 'default', label: 'Auto' },
      { id: 'grok-4.7', label: 'Grok 4.7' },
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
    ]);
    expect(cursorEffortParam(options[1]!)?.id).toBe('reasoning');
    expect(cursorFastParam(options[1]!)?.id).toBe('fast');
  });

  it('parseCursorModelsList: пикер как в Cursor — свежие семейства, не весь каталог', () => {
    const options = parseCursorModelsList({
      models: [
        { id: 'default', label: 'Auto' },
        { id: 'grok-4.7', label: 'Grok 4.7' },
        { id: 'grok-4.6', label: 'Grok 4.6' },
        { id: 'grok-4.5', label: 'Grok 4.5' },
        { id: 'claude-opus-5.5', label: 'Claude Opus 5.5' },
        { id: 'claude-opus-5', label: 'Claude Opus 5' },
        { id: 'claude-opus-4.8', label: 'Claude Opus 4.8' },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
        { id: 'gpt-5.5', label: 'GPT-5.5' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
        { id: 'codex-5.3', label: 'Codex 5.3' },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
        { id: 'muse-spark-1.3', label: 'Muse Spark 1.3' },
        { id: 'claude-fable-5.1', label: 'Claude Fable 5.1' },
        { id: 'claude-fable-5', label: 'Claude Fable 5' },
      ],
    });
    expect(options.map((o) => o.label)).toEqual([
      'Auto',
      'Grok 4.7',
      'Grok 4.6',
      'Claude Opus 5.5',
      'Claude Opus 5',
      'GPT-5.6 Sol',
      'Gemini 3.8 Flash',
      'Muse Spark 1.3',
      'Claude Fable 5.1',
    ]);
  });

  it('cursorEffortParam: без каталога всё равно Effort и Fast как в Cursor', () => {
    expect(cursorEffortParam({ id: 'auto', label: 'Auto' })?.label).toBe('Effort');
    expect(cursorEffortParam({ id: 'default', label: 'Auto' })?.id).toBe('effort');
    expect(cursorEffortParam({ id: 'composer-2.5', label: 'Composer' })?.label).toBe('Effort');
    expect(cursorFastParam({ id: 'auto', label: 'Auto' })?.id).toBe('fast');
    expect(cursorFastParam({ id: 'composer-2.5', label: 'Composer' })?.id).toBe('fast');
  });

  it('parseCursorModelSelection достаёт id и params для Agent.create', () => {
    expect(parseCursorModelSelection('')).toEqual({ id: 'auto' });
    expect(parseCursorModelSelection('auto')).toEqual({ id: 'auto' });
    expect(parseCursorModelSelection('grok-4.6')).toEqual({ id: 'grok-4.6' });
    expect(parseCursorModelSelection('grok-4.6?thinking=high')).toEqual({
      id: 'grok-4.6',
      params: [{ id: 'thinking', value: 'high' }],
    });
  });

  it('claude-code без ключа не падает на «укажите API key» — это подписочный ран', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        'data: {"type":"token","text":"Да"}\n\ndata: {"type":"done","result":"Да"}\n\n',
    });
    const god = { ...defaultGodData(), runner: 'claude-code' as const, apiKey: '' };
    await expect(completeBridgeRun(god, contextFor(god), { fetchImpl })).resolves.toBe('Да');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.runner).toBe('claude-code');
  });

  it('cursor без ключа по-прежнему требует ключ', async () => {
    const god = { ...defaultGodData(), runner: 'cursor' as const, apiKey: '' };
    await expect(completeBridgeRun(god, contextFor(god), { fetchImpl: vi.fn() })).rejects.toThrow(
      /Cursor API key/,
    );
  });
});

describe('нормализация GOD-ноды', () => {
  it('isolated по умолчанию выключен и переживает сохранение', () => {
    expect(defaultGodData().isolated).toBe(false);
    expect(normalizeGodData({ runner: 'claude-code', isolated: true }).isolated).toBe(true);
    expect(normalizeGodData({ runner: 'claude-code' }).isolated).toBe(false);
    expect(normalizeGodData({ runner: 'claude-code', isolated: 'да' } as never).isolated).toBe(false);
  });

  it('claude-code и opencode переживают coerce runner', () => {
    expect(normalizeGodData({ runner: 'claude-code' }).runner).toBe('claude-code');
    expect(normalizeGodData({ runner: 'opencode' }).runner).toBe('opencode');
    expect(normalizeGodData({ runner: 'выдумка' } as never).runner).toBe('cursor');
  });

  it('мигрирует legacy provider → runner', () => {
    expect(normalizeGodData({ provider: 'opencode' } as never).runner).toBe('opencode');
    expect(normalizeGodData({ provider: 'claude-code', runner: 'cursor' } as never).runner).toBe(
      'cursor',
    );
  });
});
