import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from '../src/app/core/utils/chat-markdown';

describe('renderChatMarkdown', () => {
  it('экранирует HTML и делает markdown-ссылки кликабельными', () => {
    const html = renderChatMarkdown(
      'См. **[постановку](https://wiki.example.com/spaces/DOCS/pages/1/)** и <script>',
    );
    expect(html).toContain('<a href="https://wiki.example.com/spaces/DOCS/pages/1/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<strong>');
    expect(html).toContain('постановку');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('отбрасывает javascript: в ссылках', () => {
    const html = renderChatMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a ');
    expect(html).toContain('x');
  });

  it('автолинкует bare https URL', () => {
    const html = renderChatMarkdown('открой https://example.com/page и всё');
    expect(html).toContain('<a href="https://example.com/page"');
    expect(html).toContain('>https://example.com/page</a>');
  });

  it('форматирует `code` и заголовки', () => {
    const html = renderChatMarkdown('## Заголовок\nкод `type = 1`');
    expect(html).toContain('chat-md-h2');
    expect(html).toContain('<code>type = 1</code>');
  });

  it('рисует GFM-таблицу', () => {
    const md = [
      '| AC | Результат |',
      '|---|---|',
      '| forced=true | FAIL |',
      '| модалка | OK |',
    ].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).toContain('<table');
    expect(html).toContain('<th>');
    expect(html).toContain('AC');
    expect(html).toContain('<td>');
    expect(html).toContain('FAIL');
    expect(html).not.toContain('|---|');
  });

  it('рисует списки и fenced code', () => {
    const md = [
      '- пункт один',
      '- пункт два',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).toContain('<ul');
    expect(html).toContain('<li>');
    expect(html).toContain('пункт один');
    expect(html).toContain('<pre class="chat-md-pre"');
    expect(html).toContain('const x = 1;');
  });

  it('нумерованный список', () => {
    const html = renderChatMarkdown('1. первый\n2. второй');
    expect(html).toContain('<ol');
    expect(html).toContain('первый');
  });
});
