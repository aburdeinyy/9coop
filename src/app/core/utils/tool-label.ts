function asRecord(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function pick(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = str(rec[key]);
    if (v) return v;
  }
  return '';
}

function clip(text: string, max = 72): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const FALLBACK: Record<string, string> = {
  grep: 'Ищу по проекту…',
  read: 'Читаю файл…',
  write: 'Пишу файл…',
  edit: 'Правим файл…',
  delete: 'Удаляю файл…',
  shell: 'Выполняю команду…',
  glob: 'Ищу файлы…',
  mcp: 'Вызов MCP…',
  semsearch: 'Семантический поиск…',
  await: 'Жду…',
  task: 'Запускаю задачу…',
};

/** Короткая человекочитаемая подпись шага tool для чата. */
export function formatToolStepLabel(name: string, args?: unknown): string {
  const tool = name.trim().toLowerCase() || 'tool';
  const rec = asRecord(args);

  if (rec) {
    if (tool === 'grep' || tool === 'rg') {
      const pattern = pick(rec, ['pattern', 'regex', 'query']);
      if (pattern) return clip(`Ищу «${pattern}»`);
    }
    if (tool === 'read') {
      const path = pick(rec, ['path', 'file_path', 'filePath', 'target']);
      if (path) return clip(`Читаю ${path}`);
    }
    if (tool === 'write' || tool === 'edit' || tool === 'delete') {
      const path = pick(rec, ['path', 'file_path', 'filePath', 'target']);
      const verb = tool === 'write' ? 'Пишу' : tool === 'edit' ? 'Правим' : 'Удаляю';
      if (path) return clip(`${verb} ${path}`);
    }
    if (tool === 'shell') {
      const command = pick(rec, ['command', 'cmd', 'script']);
      if (command) return clip(`Команда: ${command}`, 80);
    }
    if (tool === 'glob') {
      const pattern = pick(rec, ['glob_pattern', 'globPattern', 'pattern', 'glob']);
      if (pattern) return clip(`Ищу файлы ${pattern}`);
    }
    if (tool === 'mcp' || tool.startsWith('mcp')) {
      const toolName = pick(rec, ['toolName', 'tool_name', 'name', 'tool']);
      const server = pick(rec, ['server', 'serverName', 'providerIdentifier', 'provider']);
      if (toolName && server) return clip(`MCP ${server}: ${toolName}`);
      if (toolName) return clip(`MCP: ${toolName}`);
      if (server) return clip(`MCP ${server}`);
    }
    if (tool === 'semsearch' || tool === 'semantic_search') {
      const query = pick(rec, ['query', 'pattern', 'question']);
      if (query) return clip(`Ищу смысл: «${query}»`);
    }
  }

  return FALLBACK[tool] ?? `Инструмент ${name}`;
}
