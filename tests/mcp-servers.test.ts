import { describe, expect, it } from 'vitest';
import {
  buildMcpServersFromArtifacts,
  parseMcpServersFromArtifactContent,
  toSdkMcpServersRecord,
} from '../src/app/core/runtime/mcp-servers';

describe('mcp-servers mapping', () => {
  it('parseMcpServersFromArtifactContent читает http и stdio', () => {
    const content = JSON.stringify({
      mcpServers: {
        jira: {
          type: 'http',
          url: 'https://mcp.example/jira',
          headers: { Authorization: 'Bearer t' },
        },
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'x' },
        },
      },
    });

    expect(parseMcpServersFromArtifactContent(content)).toEqual([
      {
        name: 'jira',
        type: 'http',
        url: 'https://mcp.example/jira',
        headers: { Authorization: 'Bearer t' },
      },
      {
        name: 'github',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'x' },
      },
    ]);
  });

  it('buildMcpServersFromArtifacts берёт только mcp с content', () => {
    const servers = buildMcpServersFromArtifacts([
      { kind: 'skill', artifactContent: '# no' },
      { kind: 'mcp', artifactContent: '' },
      {
        kind: 'mcp',
        artifactContent: JSON.stringify({
          mcpServers: { jira: { url: 'https://jira.mcp' } },
        }),
      },
    ]);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('jira');
  });

  it('toSdkMcpServersRecord — Record для @cursor/sdk', () => {
    const record = toSdkMcpServersRecord([
      { name: 'jira', type: 'http', url: 'https://jira.mcp' },
      { name: 'gh', type: 'stdio', command: 'npx', args: ['-y', 'x'] },
    ]);
    expect(record).toEqual({
      jira: { type: 'http', url: 'https://jira.mcp' },
      gh: { type: 'stdio', command: 'npx', args: ['-y', 'x'] },
    });
  });
});
