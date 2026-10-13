import { describe, expect, it } from 'vitest';
import { GraphService } from '../src/app/core/services/graph.service';
import { normalizeArtifactData } from '../src/app/core/models/graph.model';
import { generateArtifactStub } from '../src/app/core/utils/export-artifacts';
import { ARTIFACT_GENERATION_GUIDE } from '../src/app/core/utils/layercoop-architecture';
import {
  buildLayercoopRefreshSource,
  buildPipelineStatusRefreshContent,
  extractLayercoopRefresh,
  formatRefreshInterval,
  isPureScheduleAddRequest,
  mergeScheduleIntoPrompt,
  parseAutoRefresh,
  parseMrIidFromTitle,
  pickRefreshProgram,
  runRefreshSource,
  schedulePhrase,
} from '../src/app/core/utils/auto-refresh';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

describe('parseAutoRefresh', () => {
  it('снимает интервал из «раз в N» / every / автообновление', () => {
    expect(parseAutoRefresh('обновляй список моих MR раз в 5 минут')).toEqual({
      intervalMs: 300_000,
    });
    expect(parseAutoRefresh('every 30 seconds')).toEqual({ intervalMs: 30_000 });
    expect(parseAutoRefresh('автообновление каждые 2 часа')).toEqual({
      intervalMs: 7_200_000,
    });
    expect(parseAutoRefresh('cron every 10 minutes')).toEqual({ intervalMs: 600_000 });
    expect(parseAutoRefresh('always-on skill, refresh every 1 min')).toEqual({
      intervalMs: 60_000,
    });
    expect(formatRefreshInterval(300_000)).toBe('5 мин');
  });

  it('сутки / day / крон', () => {
    expect(parseAutoRefresh('крон: обновлять скилл раз в сутки')).toEqual({
      intervalMs: 86_400_000,
    });
    expect(parseAutoRefresh('refresh every 1 day')).toEqual({ intervalMs: 86_400_000 });
    expect(parseAutoRefresh('автообновление раз в 1 день')).toEqual({
      intervalMs: 86_400_000,
    });
    expect(formatRefreshInterval(86_400_000)).toBe('1 д');
  });

  it('без расписания — null', () => {
    expect(parseAutoRefresh('покажи список MR')).toBeNull();
    expect(parseAutoRefresh('автообновление')).toBeNull();
    expect(parseAutoRefresh('просто skill')).toBeNull();
    expect(parseAutoRefresh('')).toBeNull();
  });

  it('always-on / cron без интервала → 5 мин', () => {
    expect(parseAutoRefresh('Always-on skill Ponytail')).toEqual({ intervalMs: 300_000 });
    expect(parseAutoRefresh('cron skill')).toEqual({ intervalMs: 300_000 });
    expect(parseAutoRefresh('крон на skill')).toEqual({ intervalMs: 300_000 });
  });
});

describe('MCP refresh program', () => {
  it('stub MCP с автообновлением кладёт исполняемый source без LLM', () => {
    const stub = generateArtifactStub(
      'mcp',
      'Мои MR',
      'покажи мои merge request и обновляй раз в 5 минут',
    );
    const program = extractLayercoopRefresh(stub);
    expect(program?.intervalMs).toBe(300_000);
    expect(program?.server).toBeTruthy();
    expect(program?.source).toContain('callTool');
    expect(program?.source.toLowerCase()).not.toMatch(/openai|anthropic|llm|chat\/completions/);
    expect(ARTIFACT_GENERATION_GUIDE).toContain('layercoopRefresh');
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/без\s+LLM|не\s+вызывай\s+LLM/i);
  });

  it('runRefreshSource собирает view из ответа tool', async () => {
    const source = buildLayercoopRefreshSource('MR', 'list_mrs');
    const view = await runRefreshSource(source, async (name) => {
      expect(name).toBe('list_mrs');
      return [{ title: 'Fix login', web_url: 'https://gitlab.example/mr/1', state: 'opened' }];
    });
    expect(view).toEqual({
      type: 'list',
      title: 'MR',
      items: [{ text: 'Fix login', href: 'https://gitlab.example/mr/1', meta: 'opened' }],
    });
  });

  it('runRefreshSource берёт meta из status и без строки pipeline #N', async () => {
    const source = buildLayercoopRefreshSource('pipeline', 'list_pipeline_jobs');
    const view = await runRefreshSource(source, async () => [
      {
        name: 'pipeline #216623',
        status: 'failed',
        web_url: 'https://gitlab.example/pipelines/216623',
      },
      { name: 'lint', status: 'success', web_url: 'https://gitlab.example/jobs/1' },
      { name: 'Approval', meta: 'approvals: 0/1' },
    ]);
    expect(view?.type).toBe('list');
    if (view?.type !== 'list') throw new Error('expected list');
    expect(view.items).toEqual([
      { text: 'lint', href: 'https://gitlab.example/jobs/1', meta: 'success' },
      { text: 'Approval', meta: 'approvals: 0/1' },
    ]);
  });

  it('программу берёт у соседнего MCP, если на ноде её нет', () => {
    const mcp = generateArtifactStub('mcp', 'GitLab', 'MR раз в 5 минут');
    expect(pickRefreshProgram(undefined, [mcp])?.program.server).toBeTruthy();
    expect(pickRefreshProgram('не json', [])).toBeNull();
  });

  it('программа на плитке + mcpServers у соседа GitLab (spawn pipeline)', () => {
    const tile = buildPipelineStatusRefreshContent('MR !78 pipeline', 'gitlab');
    const neighbor = JSON.stringify({
      mcpServers: { gitlab: { command: 'npx', args: ['-y', 'gitlab-mcp'] } },
    });
    const picked = pickRefreshProgram(tile, [neighbor]);
    expect(picked?.program.server).toBe('gitlab');
    expect(picked?.program.source).toContain('callTool');
    expect(picked?.artifactContent).toContain('mcpServers');
    expect(picked?.artifactContent).toContain('gitlab-mcp');
  });

  it('parseMrIidFromTitle и args для list_pipeline_jobs', () => {
    expect(parseMrIidFromTitle('MR !78 pipeline')).toBe(78);
    expect(parseMrIidFromTitle('pipeline')).toBeNull();
    const source = extractLayercoopRefresh(
      buildPipelineStatusRefreshContent('MR !78 pipeline', 'gitlab'),
    )?.source;
    expect(source).toContain('merge_request_iid');
    expect(source).toContain('78');
  });

  it('runRefreshSource с merge_request_iid в args', async () => {
    const source = buildLayercoopRefreshSource('MR !78 pipeline', 'list_pipeline_jobs', {
      merge_request_iid: 78,
    });
    const view = await runRefreshSource(source, async (name, args) => {
      expect(name).toBe('list_pipeline_jobs');
      expect(args).toEqual({ merge_request_iid: 78 });
      return [{ name: 'lint', status: 'running' }];
    });
    expect(view).toMatchObject({
      type: 'list',
      items: [{ text: 'lint', meta: 'running' }],
    });
  });
});

describe('нода помнит автообновление из промпта', () => {
  it('updateNodePrompt ставит autoRefresh и снимает, когда фразы больше нет', () => {
    const svc = new GraphService(memoryStorage());
    const id = svc.addArtifactNode();
    svc.updateNodePrompt(id, 'список MR, обновляй раз в 5 минут');
    const on = svc.graph().nodes.find((n) => n.id === id);
    if (on?.type !== 'artifact') throw new Error('expected artifact');
    expect(on.data.autoRefresh).toEqual({ intervalMs: 300_000 });

    svc.updateNodePrompt(id, 'просто список MR');
    const off = svc.graph().nodes.find((n) => n.id === id);
    if (off?.type !== 'artifact') throw new Error('expected artifact');
    expect(off.data.autoRefresh).toBeUndefined();
  });

  it('normalizeArtifactData восстанавливает интервал из промпта', () => {
    const data = normalizeArtifactData({
      kind: 'skill',
      label: 'MR',
      prompt: 'каждые 10 минут список',
      connected: true,
    });
    expect(data.autoRefresh).toEqual({ intervalMs: 600_000 });
  });
});

describe('патч крона в текущий skill', () => {
  it('isPureScheduleAddRequest — только добавить расписание', () => {
    expect(
      isPureScheduleAddRequest('крон не забудь добавить что б раз в сутки обновлять скилл'),
    ).toEqual({ intervalMs: 86_400_000 });
    expect(isPureScheduleAddRequest('добавь cron every 1 day')).toEqual({
      intervalMs: 86_400_000,
    });
    expect(isPureScheduleAddRequest('создай skill с кроном раз в сутки')).toBeNull();
    expect(isPureScheduleAddRequest('перепиши skill и добавь крон раз в сутки')).toBeNull();
  });

  it('mergeScheduleIntoPrompt дописывает фразу без дубля', () => {
    const once = mergeScheduleIntoPrompt('Ponytail full порт', 86_400_000);
    expect(once).toContain('крон');
    expect(once).toContain('сутки');
    expect(parseAutoRefresh(once)).toEqual({ intervalMs: 86_400_000 });
    expect(mergeScheduleIntoPrompt(once, 86_400_000)).toBe(once);
    expect(schedulePhrase(300_000)).toMatch(/5\s*мин/);
  });

  it('applyFocusSchedulePatch пишет autoRefresh в существующий skill', () => {
    const svc = new GraphService(memoryStorage());
    const id = svc.addArtifactNode('skill');
    svc.updateNodePrompt(id, 'Полный порт Ponytail. Режим full.');
    svc.updateNodeLabel(id, 'ponytail');

    const patch = svc.applyFocusSchedulePatch(
      id,
      'крон не забудь добавить что б раз в сутки обновлять скилл',
    );
    expect(patch).toEqual({
      intervalMs: 86_400_000,
      localOnly: true,
      label: 'ponytail',
    });
    const node = svc.graph().nodes.find((n) => n.id === id);
    if (node?.type !== 'artifact') throw new Error('artifact');
    expect(node.data.autoRefresh).toEqual({ intervalMs: 86_400_000 });
    expect(node.data.prompt).toMatch(/крон|сутк/i);
  });
});
