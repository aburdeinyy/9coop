import { describe, expect, it } from 'vitest';
import {
  GOD_NODE_ID,
  defaultGodData,
  type GraphNode,
  type LayercoopGraph,
} from '../src/app/core/models/graph.model';
import { runRuntime } from '../src/app/core/runtime/runtime-engine';
import { composeChatContext } from '../src/app/core/utils/compose-context';

const primary: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { ...defaultGodData(), label: 'Cursor' },
};

const deepseek: GraphNode = {
  id: 'god-2',
  type: 'god',
  position: { x: 200, y: 0 },
  data: {
    ...defaultGodData(),
    label: 'DeepSeek',
    runner: 'openai-compatible',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },
};

function graph(nodes: GraphNode[], edges: LayercoopGraph['edges'] = []): LayercoopGraph {
  return {
    version: 1,
    name: 'demo',
    updatedAt: '2026-09-25T00:00:00.000Z',
    nodes,
    edges,
  };
}

const noopDelay = async () => undefined;

describe('composeChatContext + sub-gods', () => {
  it('на primary с подключённым саб-GOD даёт инструкцию delegate', () => {
    const g = graph([primary, deepseek], [
      { id: 'e1', source: GOD_NODE_ID, target: 'god-2' },
    ]);
    const ctx = composeChatContext(g, 'jira', { focusNodeId: GOD_NODE_ID });
    expect(ctx.systemPrompt).toContain('layercoop-delegate');
    expect(ctx.systemPrompt).toContain('god-2');
    expect(ctx.systemPrompt).toContain('DeepSeek');
    expect(ctx.systemPrompt).not.toContain('sk-');
  });

  it('фокус на саб-GOD — executor = DeepSeek', () => {
    const g = graph([primary, deepseek]);
    const ctx = composeChatContext(g, 'hi', { focusNodeId: 'god-2' });
    expect(ctx.god.label).toBe('DeepSeek');
    expect(ctx.systemPrompt).toContain('саб-GOD');
  });
});

describe('runRuntime delegation', () => {
  it('standalone саб-GOD вызывает complete один раз на нём', async () => {
    const g = graph([primary, deepseek]);
    const executors: string[] = [];
    const events = [];
    for await (const event of runRuntime(g, 'ping', {
      delay: noopDelay,
      focusNodeId: 'god-2',
      complete: async (_graph, _prompt, opts) => {
        executors.push(opts.executorNodeId ?? opts.focusNodeId);
        return 'from-deepseek';
      },
    })) {
      events.push(event);
    }
    expect(executors).toEqual(['god-2']);
    const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
    expect(text).toContain('from-deepseek');
  });

  it('primary + sub: plan → delegate → validate, пользователю только финал', async () => {
    const g = graph([primary, deepseek], [
      { id: 'edge-sub', source: GOD_NODE_ID, target: 'god-2' },
    ]);
    let call = 0;
    const executors: string[] = [];
    const events = [];
    for await (const event of runRuntime(g, 'получи задачи из jira', {
      delay: noopDelay,
      focusNodeId: GOD_NODE_ID,
      complete: async (_graph, prompt, opts) => {
        call += 1;
        executors.push(opts.executorNodeId ?? opts.focusNodeId);
        if (call === 1) {
          return 'Делегирую.\n```layercoop-delegate\n{"targetId":"god-2","task":"Список задач Jira"}\n```';
        }
        if (call === 2) {
          expect(prompt).toContain('Список задач Jira');
          return 'TASK-1, TASK-2';
        }
        expect(prompt).toContain('TASK-1');
        return 'Вот ваши задачи: TASK-1, TASK-2';
      },
    })) {
      events.push(event);
    }
    expect(executors).toEqual([GOD_NODE_ID, 'god-2', GOD_NODE_ID]);
    expect(events.some((e) => e.type === 'node:active' && e.nodeId === 'god-2')).toBe(true);
    const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
    expect(text).toContain('TASK-1, TASK-2');
    expect(text).not.toContain('layercoop-delegate');
  });

  it('при stream на primary+sub сразу эмитит token/tool (не копит до конца)', async () => {
    const g = graph([primary, deepseek], [
      { id: 'edge-sub', source: GOD_NODE_ID, target: 'god-2' },
    ]);
    let godCalls = 0;
    const seen: string[] = [];
    for await (const event of runRuntime(g, 'go', {
      delay: noopDelay,
      focusNodeId: GOD_NODE_ID,
      stream: async function* (_graph, _prompt, opts) {
        const exec = opts.executorNodeId ?? opts.focusNodeId;
        if (exec === GOD_NODE_ID) {
          godCalls += 1;
          if (godCalls === 1) {
            yield { type: 'token', text: 'план' };
            yield { type: 'tool', name: 'read', status: 'start', callId: 't1' };
            yield { type: 'tool', name: 'read', status: 'end', callId: 't1' };
            yield {
              type: 'done',
              result:
                'ok\n```layercoop-delegate\n{"targetId":"god-2","task":"do"}\n```',
            };
            return;
          }
          yield { type: 'token', text: 'итог' };
          yield { type: 'done', result: 'итог' };
          return;
        }
        yield { type: 'token', text: 'sub-done' };
        yield { type: 'done', result: 'sub-done' };
      },
    })) {
      if (event.type === 'token') {
        seen.push(
          event.toChat === false
            ? `steps:${event.text}`
            : `chat:${event.text}`,
        );
      }
      if (event.type === 'tool:call') seen.push(`tool:${event.name}:${event.status}`);
    }
    expect(seen[0]).toBe('chat:план');
    expect(seen).toContain('tool:read:start');
    expect(seen).toContain('steps:sub-done');
    expect(seen).not.toContain('chat:sub-done');
    expect(seen).toContain('chat:итог');
  });
});
