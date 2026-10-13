import { describe, expect, it } from 'vitest';
import {
  createOpencodeState,
  opencodeBaseUrl,
  opencodeHeaders,
  parseOpencodeEvent,
  parseOpencodeModel,
} from '../bridge/src/runners/opencode';
import type { BridgeRunRequest } from '../bridge/src/types';

function req(patch: Partial<BridgeRunRequest> = {}): BridgeRunRequest {
  return { apiKey: '', prompt: 'hi', ...patch };
}

describe('opencode config', () => {
  it('baseUrl: нода → env → дефолт 4096, хвостовой слэш срезается', () => {
    expect(opencodeBaseUrl(req({ baseUrl: 'http://host:5000/' }), {})).toBe('http://host:5000');
    expect(opencodeBaseUrl(req(), { OPENCODE_BASE_URL: 'http://env:1' })).toBe('http://env:1');
    expect(opencodeBaseUrl(req(), {})).toBe('http://127.0.0.1:4096');
  });

  it('модель разбирается как provider/model, без слэша — не передаём', () => {
    expect(parseOpencodeModel('anthropic/claude-opus-5')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-opus-5',
    });
    expect(parseOpencodeModel('claude-opus-5')).toBeUndefined();
    expect(parseOpencodeModel('/leading')).toBeUndefined();
    expect(parseOpencodeModel('trailing/')).toBeUndefined();
    expect(parseOpencodeModel('')).toBeUndefined();
  });

  it('basic-auth только когда есть пароль', () => {
    expect(opencodeHeaders(req(), {})['Authorization']).toBeUndefined();
    const headers = opencodeHeaders(req({ apiKey: 'secret' }), { OPENCODE_SERVER_USERNAME: 'max' });
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from('max:secret').toString('base64')}`);
    const fromEnv = opencodeHeaders(req(), { OPENCODE_SERVER_PASSWORD: 'p' });
    expect(fromEnv['Authorization']).toBe(`Basic ${Buffer.from('opencode:p').toString('base64')}`);
  });
});

describe('opencode events', () => {
  it('части приходят кумулятивно — отдаём дельту', () => {
    const state = createOpencodeState('s1');
    const part = (text: string) => ({
      type: 'message.part.updated',
      properties: { part: { id: 'p1', sessionID: 's1', type: 'text', text } },
    });
    expect(parseOpencodeEvent(part('Прив'), state)).toEqual([{ type: 'token', text: 'Прив' }]);
    expect(parseOpencodeEvent(part('Привет'), state)).toEqual([{ type: 'token', text: 'ет' }]);
    expect(parseOpencodeEvent(part('Привет'), state)).toEqual([]);
    expect(state.result).toBe('Привет');
  });

  it('текст user-сообщения (наш промпт) не эхоится в ответ', () => {
    const state = createOpencodeState('s1');
    parseOpencodeEvent(
      { type: 'message.updated', properties: { info: { id: 'u1', role: 'user', sessionID: 's1' } } },
      state,
    );
    const echo = {
      type: 'message.part.updated',
      properties: { part: { id: 'p0', type: 'text', text: 'prompt', sessionID: 's1', messageID: 'u1' } },
    };
    expect(parseOpencodeEvent(echo, state)).toEqual([]);
    const answer = {
      type: 'message.part.updated',
      properties: { part: { id: 'p1', type: 'text', text: 'ok', sessionID: 's1', messageID: 'a1' } },
    };
    expect(parseOpencodeEvent(answer, state)).toEqual([{ type: 'token', text: 'ok' }]);
    expect(state.result).toBe('ok');
  });

  it('чужая сессия игнорируется', () => {
    const state = createOpencodeState('s1');
    const foreign = {
      type: 'message.part.updated',
      properties: { part: { id: 'p9', sessionID: 'other', type: 'text', text: 'нет' } },
    };
    expect(parseOpencodeEvent(foreign, state)).toEqual([]);
    expect(state.result).toBe('');
  });

  it('tool: running → start, completed → end, повтор статуса молчит', () => {
    const state = createOpencodeState('s1');
    const tool = (status: string) => ({
      type: 'message.part.updated',
      properties: {
        part: { id: 't1', sessionID: 's1', type: 'tool', tool: 'read', state: { status } },
      },
    });
    expect(parseOpencodeEvent(tool('running'), state)).toEqual([
      { type: 'tool', name: 'read', status: 'start', callId: 't1' },
    ]);
    expect(parseOpencodeEvent(tool('running'), state)).toEqual([]);
    expect(parseOpencodeEvent(tool('completed'), state)).toEqual([
      { type: 'tool', name: 'read', status: 'end', callId: 't1' },
    ]);
  });

  it('session.idle завершает ран накопленным текстом', () => {
    const state = createOpencodeState('s1');
    state.result = 'итог';
    expect(parseOpencodeEvent({ type: 'session.idle', properties: { sessionID: 's1' } }, state)).toEqual([
      { type: 'done', result: 'итог' },
    ]);
  });

  it('idle чужой сессии не завершает наш ран', () => {
    const state = createOpencodeState('s1');
    expect(
      parseOpencodeEvent({ type: 'session.idle', properties: { sessionID: 'other' } }, state),
    ).toEqual([]);
  });

  it('session.error → error', () => {
    const state = createOpencodeState('s1');
    const events = parseOpencodeEvent(
      { type: 'session.error', properties: { error: { message: 'провайдер не настроен' } } },
      state,
    );
    expect(events).toEqual([{ type: 'error', message: 'провайдер не настроен' }]);
  });

  it('мусор не роняет парсер', () => {
    const state = createOpencodeState('s1');
    expect(parseOpencodeEvent(null, state)).toEqual([]);
    expect(parseOpencodeEvent({ type: 'unknown.thing' }, state)).toEqual([]);
    expect(parseOpencodeEvent({ type: 'message.part.updated', properties: {} }, state)).toEqual([]);
  });
});
