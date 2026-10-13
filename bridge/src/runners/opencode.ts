import { DEFAULT_OPENCODE_BASE_URL } from '../../../src/app/core/runtime/local-runners';
import { loadEnvIntoProcess } from '../env-store';
import { buildPrompt } from '../prompt';
import type { AgentRunner, BridgeRunRequest, BridgeSseEvent } from '../types';

export const OPENCODE_OFFLINE_HINT =
  'Headless-сервер opencode недоступен. Запусти `opencode serve` (по умолчанию 127.0.0.1:4096).';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function opencodeBaseUrl(req: BridgeRunRequest, env: NodeJS.ProcessEnv = {}): string {
  const raw = req.baseUrl?.trim() || env['OPENCODE_BASE_URL']?.trim() || DEFAULT_OPENCODE_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * opencode ждёт пару provider/model. В UI Layercoop модель — одна строка,
 * поэтому используем запись `anthropic/claude-opus-5`. Без слэша модель
 * не передаём — сервер возьмёт свою дефолтную.
 */
export function parseOpencodeModel(
  model: string | undefined,
): { providerID: string; modelID: string } | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1),
  };
}

/** `opencode serve` защищается basic-auth через OPENCODE_SERVER_PASSWORD. */
export function opencodeHeaders(
  req: BridgeRunRequest,
  env: NodeJS.ProcessEnv = {},
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const password = req.apiKey?.trim() || env['OPENCODE_SERVER_PASSWORD']?.trim() || '';
  if (password) {
    const user = env['OPENCODE_SERVER_USERNAME']?.trim() || 'opencode';
    headers['Authorization'] = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }
  return headers;
}

export interface OpencodeStreamState {
  sessionId: string;
  textByPart: Map<string, string>;
  toolStatus: Map<string, string>;
  /** id user-сообщений: их text-части — это наш же промпт, в чат не отдаём. */
  userMessages: Set<string>;
  result: string;
}

export function createOpencodeState(sessionId: string): OpencodeStreamState {
  return {
    sessionId,
    textByPart: new Map(),
    toolStatus: new Map(),
    userMessages: new Set(),
    result: '',
  };
}

const TOOL_RUNNING = new Set(['running', 'pending']);
const TOOL_FINISHED = new Set(['completed', 'error', 'cancelled']);

/**
 * Событие SSE opencode → события bridge.
 * Части приходят кумулятивно (весь текст части целиком), поэтому отдаём дельту
 * относительно уже отправленного.
 */
export function parseOpencodeEvent(
  event: unknown,
  state: OpencodeStreamState,
): BridgeSseEvent[] {
  if (!isRecord(event)) return [];
  const type = event['type'];
  const props = isRecord(event['properties']) ? event['properties'] : {};

  if (type === 'session.idle') {
    const sessionID = props['sessionID'];
    if (typeof sessionID === 'string' && sessionID !== state.sessionId) return [];
    return [{ type: 'done', result: state.result }];
  }

  if (type === 'session.error') {
    const error = props['error'];
    const message = isRecord(error)
      ? String(error['message'] ?? error['name'] ?? 'opencode session error')
      : 'opencode session error';
    return [{ type: 'error', message }];
  }

  if (type === 'message.updated') {
    const info = props['info'];
    if (isRecord(info) && info['role'] === 'user' && typeof info['id'] === 'string') {
      state.userMessages.add(info['id']);
    }
    return [];
  }

  if (type !== 'message.part.updated') return [];

  const part = props['part'];
  if (!isRecord(part)) return [];

  const sessionID = part['sessionID'];
  if (typeof sessionID === 'string' && sessionID !== state.sessionId) return [];

  const messageID = part['messageID'];
  if (typeof messageID === 'string' && state.userMessages.has(messageID)) return [];

  const partId = typeof part['id'] === 'string' ? part['id'] : '';

  if (part['type'] === 'text') {
    const text = typeof part['text'] === 'string' ? part['text'] : '';
    if (!text) return [];
    const seen = state.textByPart.get(partId) ?? '';
    const delta = text.startsWith(seen) ? text.slice(seen.length) : text;
    state.textByPart.set(partId, text);
    if (!delta) return [];
    state.result += delta;
    return [{ type: 'token', text: delta }];
  }

  if (part['type'] === 'tool') {
    const name = typeof part['tool'] === 'string' ? part['tool'] : 'tool';
    const partState = isRecord(part['state']) ? part['state'] : {};
    const status = typeof partState['status'] === 'string' ? partState['status'] : '';
    const previous = state.toolStatus.get(partId) ?? '';
    if (status === previous) return [];
    state.toolStatus.set(partId, status);
    if (TOOL_RUNNING.has(status) && !TOOL_RUNNING.has(previous)) {
      return [{ type: 'tool', name, status: 'start', callId: partId || undefined }];
    }
    if (TOOL_FINISHED.has(status) && !TOOL_FINISHED.has(previous)) {
      return [{ type: 'tool', name, status: 'end', callId: partId || undefined }];
    }
  }

  return [];
}

/** Читает text/event-stream и отдаёт распарсенные `data:` объекты. */
export async function* iterateSse(res: Response): AsyncGenerator<unknown> {
  if (!res.body || typeof res.body.getReader !== 'function') return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      const line = block
        .split('\n')
        .map((l) => l.trimEnd())
        .find((l) => l.startsWith('data:'));
      if (!line) continue;
      const json = line.replace(/^data:\s?/, '').trim();
      if (!json || json === '[DONE]') continue;
      try {
        yield JSON.parse(json);
      } catch {
        /* skip malformed */
      }
    }
  }
}

export interface OpencodeDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Клиент к headless-серверу opencode (`opencode serve`): REST + SSE `/event`.
 * Идём по HTTP напрямую, а не через @opencode-ai/sdk — bridge и так говорит
 * сырым http, а лишняя зависимость тянула бы генерируемый клиент.
 */
export function createOpencodeRunner(deps: OpencodeDeps = {}): AgentRunner {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async function* (req: BridgeRunRequest): AsyncGenerator<BridgeSseEvent> {
    const cwd = req.cwd?.trim() || process.cwd();
    loadEnvIntoProcess(cwd);

    const base = opencodeBaseUrl(req, process.env);
    const headers = opencodeHeaders(req, process.env);

    let sessionId: string;
    let events: Response;
    const controller = new AbortController();

    try {
      const created = await fetchImpl(`${base}/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Layercoop GOD' }),
      });
      if (!created.ok) {
        const body = await created.text().catch(() => '');
        yield {
          type: 'error',
          message: body.trim() || `opencode POST /session — HTTP ${created.status}`,
        };
        return;
      }
      const session = (await created.json()) as unknown;
      const id = isRecord(session) ? session['id'] : undefined;
      if (typeof id !== 'string' || !id) {
        yield { type: 'error', message: 'opencode не вернул id сессии' };
        return;
      }
      sessionId = id;

      events = await fetchImpl(`${base}/event`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!events.ok) {
        yield { type: 'error', message: `opencode GET /event — HTTP ${events.status}` };
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: `${OPENCODE_OFFLINE_HINT} (${message})` };
      return;
    }

    const state = createOpencodeState(sessionId);
    const model = parseOpencodeModel(req.model);
    console.log(
      `[layercoop-bridge] opencode ${base} session=${sessionId}` +
        ` model=${model ? `${model.providerID}/${model.modelID}` : '(default)'}`,
    );

    // Сообщение отправляем после подписки на /event, иначе первые токены теряются.
    // POST /message блокируется до конца рана, поэтому его нельзя await'ить
    // перед чтением стрима — ошибку забираем асинхронно.
    let postError: string | null = null;
    const posted = fetchImpl(`${base}/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(model ? { model } : {}),
        parts: [{ type: 'text', text: buildPrompt(req) }],
      }),
    })
      .then(async (res) => {
        if (res.ok) return;
        const body = await res.text().catch(() => '');
        postError = body.trim() || `opencode POST /message — HTTP ${res.status}`;
      })
      .catch((err: unknown) => {
        postError = err instanceof Error ? err.message : String(err);
      });

    try {
      for await (const event of iterateSse(events)) {
        if (postError) {
          yield { type: 'error', message: postError };
          return;
        }
        for (const out of parseOpencodeEvent(event, state)) {
          yield out;
          if (out.type === 'done' || out.type === 'error') return;
        }
      }

      await posted;
      if (postError) {
        yield { type: 'error', message: postError };
        return;
      }
      yield state.result
        ? { type: 'done', result: state.result }
        : { type: 'error', message: 'opencode закрыл поток без ответа' };
    } finally {
      controller.abort();
    }
  };
}

export const runOpencodeAgent: AgentRunner = createOpencodeRunner();
