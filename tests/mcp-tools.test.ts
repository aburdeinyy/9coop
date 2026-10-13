import { describe, expect, it } from 'vitest';
import {
  extractDeclaredMcpTools,
  formatMcpToolsSummary,
  mcpServerStatusFromArtifact,
} from '../src/app/core/utils/mcp-tools';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';

const skillMd = `
# Confluence
1. Вызови MCP-инструмент \`confluence_test_connection\`.
- **По тексту:** \`confluence_search_pages\`
- \`confluence_get_page\`
`;

describe('mcp-tools declared list', () => {
  it('extractDeclaredMcpTools вытаскивает имена из markdown/JSON текста', () => {
    expect(extractDeclaredMcpTools(skillMd)).toEqual([
      'confluence_get_page',
      'confluence_search_pages',
      'confluence_test_connection',
    ]);
  });

  it('mcpServerStatusFromArtifact читает серверы из mcpServers JSON', () => {
    const status = mcpServerStatusFromArtifact(
      JSON.stringify({
        mcpServers: {
          confluence: {
            command: 'npx',
            args: ['-y', 'atlassian-confluence-mcp-server'],
          },
        },
      }),
    );
    expect(status).toEqual([
      {
        name: 'confluence',
        transport: 'stdio',
        detail: 'npx -y atlassian-confluence-mcp-server',
      },
    ]);
  });

  it('formatMcpToolsSummary компактная строка', () => {
    expect(formatMcpToolsSummary(['a', 'b', 'c'], 2)).toBe('a, b +1');
  });

  it('composeChatContext кладёт declared tools и запрет «рестарта GOD»', () => {
    const graph: LayercoopGraph = {
      id: 'g',
      name: 't',
      createdAt: 'x',
      updatedAt: 'x',
      nodes: [
        {
          id: GOD_NODE_ID,
          type: 'god',
          position: { x: 0, y: 0 },
          data: defaultGodData(),
        },
        {
          id: 'mcp-1',
          type: 'artifact',
          position: { x: 1, y: 1 },
          data: {
            kind: 'mcp',
            label: 'confluence',
            prompt: 'wiki',
            artifactPath: '.layercoop/mcp.d/confluence.json',
            artifactContent: JSON.stringify({
              mcpServers: {
                confluence: { command: 'npx', args: ['-y', 'x'] },
              },
            }),
          },
        },
        {
          id: 'skill-1',
          type: 'artifact',
          position: { x: 2, y: 2 },
          data: {
            kind: 'skill',
            label: 'Confluence',
            prompt: 'wiki skill',
            artifactContent: skillMd,
          },
        },
      ],
      edges: [
        { id: 'e1', source: GOD_NODE_ID, target: 'mcp-1' },
        { id: 'e2', source: GOD_NODE_ID, target: 'skill-1' },
      ],
    };

    const { systemPrompt } = composeChatContext(graph, 'найди страницу');
    expect(systemPrompt).toContain('confluence_test_connection');
    expect(systemPrompt).toMatch(/tool-loop|Agent\.create|mcpServers/i);
    expect(systemPrompt).not.toMatch(/перезапуст(и|ите) сессию GOD/i);
  });
});
