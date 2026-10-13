import { describe, expect, it } from 'vitest';
import { formatToolStepLabel } from '../src/app/core/utils/tool-label';

describe('formatToolStepLabel', () => {
  it('grep с pattern', () => {
    expect(formatToolStepLabel('grep', { pattern: 'closeSessionEvent' })).toBe(
      'Ищу «closeSessionEvent»',
    );
  });

  it('read с path', () => {
    expect(formatToolStepLabel('read', { path: 'src/app/foo.ts' })).toBe(
      'Читаю src/app/foo.ts',
    );
  });

  it('shell с command — коротко', () => {
    expect(formatToolStepLabel('shell', { command: 'git status' })).toBe(
      'Команда: git status',
    );
  });

  it('shell длинную команду обрезает', () => {
    const cmd = 'a'.repeat(120);
    const label = formatToolStepLabel('shell', { command: cmd });
    expect(label.startsWith('Команда: ')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(80);
  });

  it('glob', () => {
    expect(formatToolStepLabel('glob', { glob_pattern: '**/*.ts' })).toBe(
      'Ищу файлы **/*.ts',
    );
  });

  it('mcp с именем инструмента', () => {
    expect(
      formatToolStepLabel('mcp', { toolName: 'jira_search', server: 'jira' }),
    ).toBe('MCP jira: jira_search');
  });

  it('без args — глагол по имени', () => {
    expect(formatToolStepLabel('grep')).toBe('Ищу по проекту…');
    expect(formatToolStepLabel('read')).toBe('Читаю файл…');
    expect(formatToolStepLabel('shell')).toBe('Выполняю команду…');
  });
});
