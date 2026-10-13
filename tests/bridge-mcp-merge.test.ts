import { describe, expect, it } from 'vitest';
import { mergeMcpServers } from '../bridge/src/run-agent';

describe('bridge mcp merge', () => {
  it('disk заполняет пробелы, request перекрывает имя', () => {
    const merged = mergeMcpServers(
      {
        confluence: { command: 'npx', args: ['-y', 'from-disk'] },
        jira: { command: 'npx', args: ['-y', 'jira'] },
      },
      {
        confluence: { command: 'npx', args: ['-y', 'from-graph'] },
      },
    );
    expect(merged.confluence).toEqual({ command: 'npx', args: ['-y', 'from-graph'] });
    expect(merged.jira).toEqual({ command: 'npx', args: ['-y', 'jira'] });
  });
});
