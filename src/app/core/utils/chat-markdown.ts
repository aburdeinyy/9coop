import { sanitizeViewHref } from './node-view';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeLink(hrefRaw: string, labelHtml: string): string {
  const href = sanitizeViewHref(hrefRaw.trim());
  if (!href) return labelHtml;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
}

function formatInline(text: string): string {
  let out = text;

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    safeLink(url, label),
  );

  out = out.replace(
    /(^|[\s(>])(https?:\/\/[^\s)<"]+)/g,
    (_m, pre: string, url: string) => `${pre}${safeLink(url, url)}`,
  );

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return out;
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isTableSep(line: string): boolean {
  const cells = splitCells(line);
  if (cells.length < 2) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && !isTableSep(t);
}

function renderTable(block: string[]): string {
  if (block.length < 2 || !isTableSep(block[1]!)) {
    return block.map((l) => formatInline(l)).join('<br />');
  }
  const head = splitCells(block[0]!);
  const body = block.slice(2).filter(isTableRow).map(splitCells);
  const th = head.map((c) => `<th>${formatInline(c)}</th>`).join('');
  const rows = body
    .map((cells) => {
      const tds = head
        .map((_, i) => `<td>${formatInline(cells[i] ?? '')}</td>`)
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<div class="chat-md-table-wrap"><table class="chat-md-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderList(items: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const lis = items.map((item) => `<li>${formatInline(item)}</li>`).join('');
  return `<${tag} class="chat-md-list">${lis}</${tag}>`;
}

/**
 * Лёгкий markdown → HTML для чата.
 * Escape → fences → block (tables/lists/headings) → inline.
 */
export function renderChatMarkdown(raw: string): string {
  const source = raw ?? '';
  const fences: string[] = [];
  let text = escapeHtml(source).replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (_m, _lang: string, code: string) => {
      const i = fences.length;
      fences.push(
        `<pre class="chat-md-pre"><code>${code.replace(/\n$/, '')}</code></pre>`,
      );
      return `\n%%FENCE_${i}%%\n`;
    },
  );

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fenceMatch = line.match(/^%%FENCE_(\d+)%%$/);
    if (fenceMatch) {
      out.push(fences[Number(fenceMatch[1])] ?? '');
      i += 1;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1] ?? '')) {
      const block: string[] = [];
      while (i < lines.length && (isTableRow(lines[i] ?? '') || isTableSep(lines[i] ?? ''))) {
        block.push(lines[i]!);
        i += 1;
      }
      out.push(renderTable(block));
      continue;
    }

    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = (lines[i] ?? '').match(/^[-*]\s+(.+)$/);
        if (!m) break;
        items.push(m[1]!);
        i += 1;
      }
      out.push(renderList(items, false));
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = (lines[i] ?? '').match(/^\d+\.\s+(.+)$/);
        if (!m) break;
        items.push(m[1]!);
        i += 1;
      }
      out.push(renderList(items, true));
      continue;
    }

    if (/^### /.test(line)) {
      out.push(`<div class="chat-md-h3">${formatInline(line.slice(4))}</div>`);
      i += 1;
      continue;
    }
    if (/^## /.test(line)) {
      out.push(`<div class="chat-md-h2">${formatInline(line.slice(3))}</div>`);
      i += 1;
      continue;
    }
    if (/^# /.test(line)) {
      out.push(`<div class="chat-md-h1">${formatInline(line.slice(2))}</div>`);
      i += 1;
      continue;
    }

    if (/^---$/.test(line.trim())) {
      out.push('<hr class="chat-md-hr" />');
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      out.push('');
      i += 1;
      continue;
    }

    // абзац: склеиваем непустые строки до пустой/блока
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '') break;
      if (/^%%FENCE_\d+%%$/.test(l)) break;
      if (isTableRow(l) && i + 1 < lines.length && isTableSep(lines[i + 1] ?? '')) break;
      if (/^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l)) break;
      if (/^#{1,3} /.test(l) || /^---$/.test(l.trim())) break;
      para.push(l);
      i += 1;
    }
    out.push(`<p class="chat-md-p">${para.map(formatInline).join('<br />')}</p>`);
  }

  return out.join('\n');
}
