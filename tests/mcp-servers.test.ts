import { describe, expect, it } from 'vitest';
import { defaultGodData } from '../src/app/core/models/graph.model';
import {
  buildMcpServersFromArtifacts,
  parseMcpServersFromArtifactContent,
  toSdkMcpServersRecord,
  withRepoFilesystemMcp,
} from '../src/app/core/runtime/mcp-servers';
import { buildCursorMcpServers } from '../src/app/core/runtime/llm-provider';
import type { ChatContext } from '../src/app/core/utils/compose-context';

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

  it('withRepoFilesystemMcp подменяет битый launcher на server-filesystem с корнями', () => {
    const base = [
      {
        name: 'repos-fs',
        type: 'stdio' as const,
        command: 'node',
        args: ['.layercoop/mcp.d/repos-fs.mjs'],
      },
      {
        name: 'jira',
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', 'jira'],
      },
    ];
    const next = withRepoFilesystemMcp(base, [
      '/Users/alt/Work/mkpistt',
      '/Users/alt/Work/mkpi-tmk',
    ]);
    expect(next.find((s) => s.name === 'jira')?.command).toBe('npx');
    const fs = next.find((s) => s.name === 'repos-fs');
    expect(fs?.command).toBe('npx');
    expect(fs?.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/Users/alt/Work/mkpistt',
      '/Users/alt/Work/mkpi-tmk',
    ]);
  });

  it('withRepoFilesystemMcp без корней не трогает конфиг', () => {
    const base = [
      {
        name: 'repos-fs',
        command: 'node',
        args: ['.layercoop/mcp.d/repos-fs.mjs'],
      },
    ];
    expect(withRepoFilesystemMcp(base, [])).toEqual(base);
  });

  it('buildCursorMcpServers добавляет repos-fs из repoRoots даже без mcp-ноды', () => {
    const ctx: ChatContext = {
      systemPrompt: 's',
      userPrompt: 'u',
      connectedArtifacts: [],
      selectedArtifactIds: [],
      god: defaultGodData(),
      focusNodeId: 'god-1',
      repoRoots: ['/Users/alt/Work/mkpistt'],
    };
    const servers = buildCursorMcpServers(ctx);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('repos-fs');
    expect(servers[0]?.args).toContain('/Users/alt/Work/mkpistt');
  });
});
