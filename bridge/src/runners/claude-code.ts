import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  toSdkMcpServersRecord,
  type McpServerInline,
  type SdkMcpServersRecord,
} from '../../../src/app/core/runtime/mcp-servers';
import { applyProcessEnvToMcpServers } from '../../../src/app/core/utils/dotenv-format';
import { loadEnvIntoProcess } from '../env-store';
import { createEventQueue, createLineSplitter } from '../event-queue';
import { buildPrompt } from '../prompt';
import type { AgentRunner, BridgeRunRequest, BridgeSseEvent } from '../types';

/**
 * Запрос пользователя уходит на stdin, а не в argv: так в командной строке нет
 * пользовательского текста (нет проблемы экранирования на Windows) и нет лимита
 * длины argv.
 */
export const CLAUDE_CODE_STDIN_INSTRUCTION =
  'Запрос пользователя и контекст графа переданы на stdin. Выполни их.';

export const DEFAULT_CLAUDE_CODE_BIN = 'claude';
export const DEFAULT_PERMISSION_MODE = 'acceptEdits';

/** Пускаем в argv только безопасный id модели. */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;

export interface ClaudeCodeArgsOptions {
  model?: string;
  isolated?: boolean;
  systemPromptFile?: string;
  mcpConfigFile?: string;
  permissionMode?: string;
}

export function buildClaudeCodeArgs(options: ClaudeCodeArgsOptions = {}): string[] {
  const args = [
    '-p',
    CLAUDE_CODE_STDIN_INSTRUCTION,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  // --bare отключает автозагрузку CLAUDE.md / хуков / .mcp.json / плагинов.
  if (options.isolated) args.push('--bare');

  const model = options.model?.trim();
  if (model && MODEL_ID_RE.test(model)) args.push('--model', model);

  if (options.systemPromptFile) {
    args.push('--append-system-prompt-file', options.systemPromptFile);
  }
  if (options.mcpConfigFile) {
    args.push('--mcp-config', options.mcpConfigFile);
  }

  args.push('--permission-mode', options.permissionMode ?? DEFAULT_PERMISSION_MODE);
  return args;
}

/**
 * На Windows .cmd-шим нельзя запустить без shell, а Node при shell:true склеивает
 * argv пробелами без экранирования. Все аргументы здесь наши (текст пользователя
 * идёт на stdin), поэтому достаточно обернуть то, что содержит пробелы.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg.length > 0 && !/[\s"^&|<>()%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function buildSpawnArgs(args: string[], platform: string = process.platform): string[] {
  return platform === 'win32' ? args.map(quoteWindowsArg) : args;
}

export interface ClaudeCodeStreamState {
  toolNames: Map<string, string>;
  text: string;
  sessionId: string;
  mcpServers: string[];
  mcpErrors: string[];
}

export function createClaudeCodeState(): ClaudeCodeStreamState {
  return { toolNames: new Map(), text: '', sessionId: '', mcpServers: [], mcpErrors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentBlocks(message: unknown): Record<string, unknown>[] {
  if (!isRecord(message)) return [];
  const content = message['content'];
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * Одна строка `--output-format stream-json` → события bridge.
 * Текст берём только из stream_event/text_delta: блоки assistant-сообщения
 * повторяют уже отданные дельты.
 */
export function parseClaudeCodeLine(
  line: string,
  state: ClaudeCodeStreamState,
): BridgeSseEvent[] {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(msg)) return [];

  const type = msg['type'];

  if (type === 'stream_event') {
    const event = msg['event'];
    if (!isRecord(event)) return [];
    const delta = event['delta'];
    if (isRecord(delta) && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      state.text += delta['text'];
      return [{ type: 'token', text: delta['text'] }];
    }
    return [];
  }

  if (type === 'assistant') {
    const events: BridgeSseEvent[] = [];
    for (const block of contentBlocks(msg['message'])) {
      if (block['type'] !== 'tool_use') continue;
      const id = typeof block['id'] === 'string' ? block['id'] : '';
      const name = typeof block['name'] === 'string' ? block['name'] : 'tool';
      if (id) state.toolNames.set(id, name);
      events.push({ type: 'tool', name, status: 'start', callId: id || undefined });
    }
    return events;
  }

  if (type === 'user') {
    const events: BridgeSseEvent[] = [];
    for (const block of contentBlocks(msg['message'])) {
      if (block['type'] !== 'tool_result') continue;
      const id = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : '';
      const name = state.toolNames.get(id) ?? 'tool';
      events.push({ type: 'tool', name, status: 'end', callId: id || undefined });
    }
    return events;
  }

  if (type === 'system') {
    if (msg['subtype'] === 'init') {
      if (typeof msg['session_id'] === 'string') state.sessionId = msg['session_id'];
      const servers = msg['mcp_servers'];
      if (Array.isArray(servers)) {
        state.mcpServers = servers
          .filter(isRecord)
          .map((s) => `${String(s['name'] ?? '?')}:${String(s['status'] ?? '?')}`);
      }
      const errors = msg['mcp_server_errors'];
      if (Array.isArray(errors)) {
        state.mcpErrors = errors
          .filter(isRecord)
          .map((e) => `${String(e['name'] ?? '?')} — ${String(e['message'] ?? e['type'] ?? '?')}`);
      }
    }
    return [];
  }

  if (type === 'result') {
    const text = typeof msg['result'] === 'string' ? msg['result'] : '';
    if (msg['is_error'] === true || (msg['subtype'] && msg['subtype'] !== 'success')) {
      return [{ type: 'error', message: text || `Claude Code: ${String(msg['subtype'])}` }];
    }
    return [{ type: 'done', result: text || state.text }];
  }

  return [];
}

function normalizeMcpServers(input: BridgeRunRequest['mcpServers']): SdkMcpServersRecord {
  if (!input) return {};
  if (Array.isArray(input)) return toSdkMcpServersRecord(input as McpServerInline[]);
  const record: SdkMcpServersRecord = {};
  for (const [name, cfg] of Object.entries(input)) {
    if (isRecord(cfg)) record[name] = cfg as SdkMcpServersRecord[string];
  }
  return record;
}

/**
 * Изолированный ран (`--bare`) не читает подписочный login — ему нужен ключ.
 * Подписочный ран, наоборот, не должен видеть ANTHROPIC_API_KEY, иначе Claude Code
 * молча уйдёт на биллинг по API вместо лимитов Pro/Max.
 */
export function resolveClaudeCodeAuth(
  req: BridgeRunRequest,
  env: NodeJS.ProcessEnv,
): { env: NodeJS.ProcessEnv; mode: 'api-key' | 'subscription'; error?: string } {
  const next: NodeJS.ProcessEnv = { ...env };
  const apiKey = req.apiKey?.trim() ?? '';

  if (req.isolated) {
    const key = apiKey || env['ANTHROPIC_API_KEY'] || '';
    if (!key) {
      return {
        env: next,
        mode: 'api-key',
        error:
          'Изолированный ран (--bare) не использует подписочный login Claude Code. ' +
          'Укажите Anthropic API key на GOD-ноде или ANTHROPIC_API_KEY в Secrets, ' +
          'либо снимите галочку «Изолированный ран».',
      };
    }
    next['ANTHROPIC_API_KEY'] = key;
    return { env: next, mode: 'api-key' };
  }

  if (apiKey) {
    next['ANTHROPIC_API_KEY'] = apiKey;
    return { env: next, mode: 'api-key' };
  }

  delete next['ANTHROPIC_API_KEY'];
  return { env: next, mode: 'subscription' };
}

export interface ClaudeCodeSpawnDeps {
  spawnImpl?: typeof spawn;
  binary?: string;
  platform?: string;
}

/**
 * Запускает немодифицированный бинарь Claude Code как подпроцесс. Layercoop не
 * трогает и не хранит учётные данные Claude — их держит сам CLI. Это условие
 * code.claude.com/docs/en/legal-and-compliance: свой OAuth-флоу к claude.ai
 * стороннему приложению запрещён, вход пользователя в немодифицированный
 * бинарь — разрешён.
 */
export function createClaudeCodeRunner(deps: ClaudeCodeSpawnDeps = {}): AgentRunner {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const platform = deps.platform ?? process.platform;

  return async function* (req: BridgeRunRequest): AsyncGenerator<BridgeSseEvent> {
    const cwd = req.cwd?.trim() || process.cwd();
    loadEnvIntoProcess(cwd);

    const auth = resolveClaudeCodeAuth(req, process.env);
    if (auth.error) {
      yield { type: 'error', message: auth.error };
      return;
    }

    const binary = deps.binary ?? process.env['LAYERCOOP_CLAUDE_BIN'] ?? DEFAULT_CLAUDE_CODE_BIN;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layercoop-cc-'));
    const state = createClaudeCodeState();
    const queue = createEventQueue<BridgeSseEvent>();

    try {
      let systemPromptFile: string | undefined;
      if (req.systemContext?.trim()) {
        systemPromptFile = path.join(dir, 'system-prompt.txt');
        fs.writeFileSync(systemPromptFile, req.systemContext.trim(), 'utf8');
      }

      let mcpConfigFile: string | undefined;
      const mcpServers = applyProcessEnvToMcpServers(
        normalizeMcpServers(req.mcpServers),
        process.env,
      );
      if (Object.keys(mcpServers).length) {
        mcpConfigFile = path.join(dir, 'mcp.json');
        fs.writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers }, null, 2), 'utf8');
      }

      const args = buildClaudeCodeArgs({
        model: req.model,
        isolated: req.isolated,
        systemPromptFile,
        mcpConfigFile,
      });

      console.log(
        `[layercoop-bridge] claude-code cwd=${cwd} auth=${auth.mode}` +
          ` isolated=${req.isolated ? 'yes' : 'no'}` +
          ` mcp=${Object.keys(mcpServers).join(',') || '(none)'}`,
      );

      const child = spawnImpl(binary, buildSpawnArgs(args, platform), {
        cwd,
        env: auth.env,
        shell: platform === 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      let finished = false;
      const splitter = createLineSplitter((line) => {
        for (const event of parseClaudeCodeLine(line, state)) {
          if (event.type === 'done' || event.type === 'error') finished = true;
          queue.push(event);
        }
      });

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => splitter.push(chunk));
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (err: Error) => {
        queue.push({
          type: 'error',
          message:
            (err as NodeJS.ErrnoException).code === 'ENOENT'
              ? `Не найден бинарь Claude Code (${binary}). Установи Claude Code и выполни \`claude\` один раз, чтобы войти.`
              : err.message,
        });
        queue.close();
      });

      child.on('close', (code: number | null) => {
        splitter.flush();
        if (state.mcpErrors.length) {
          console.warn(`[layercoop-bridge] claude-code MCP errors: ${state.mcpErrors.join('; ')}`);
        }
        if (!finished) {
          const detail = stderr.trim() || `claude завершился с кодом ${code ?? '?'}`;
          queue.push(
            state.text ? { type: 'done', result: state.text } : { type: 'error', message: detail },
          );
        }
        queue.close();
      });

      child.stdin?.end(buildPrompt(req), 'utf8');

      for await (const event of queue.stream()) {
        yield event;
        if (event.type === 'done' || event.type === 'error') return;
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

export const runClaudeCodeAgent: AgentRunner = createClaudeCodeRunner();
