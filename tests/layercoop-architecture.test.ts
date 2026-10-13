import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_GENERATION_GUIDE,
  layercoopArchitecturePromptBlock,
} from '../src/app/core/utils/layercoop-architecture';
import { generateArtifactStub } from '../src/app/core/utils/export-artifacts';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import { GOD_NODE_ID, defaultGodData } from '../src/app/core/models/graph.model';
import type { LayercoopGraph } from '../src/app/core/models/graph.model';

describe('Layercoop architecture for artifact generation', () => {
  it('guide описывает форматы skill/mcp/agent/rule/pawn под .layercoop', () => {
    expect(ARTIFACT_GENERATION_GUIDE).toContain('.layercoop/skills/{slug}/SKILL.md');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('.layercoop/mcp.d/{slug}.json');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('mcpServers');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('.layercoop/agents/{slug}.md');
    expect(ARTIFACT_GENERATION_GUIDE).toContain('.layercoop/rules/{slug}.mdc');
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/ЗАПРЕЩЕНО[\s\S]*\.cursor\//i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/GOD|граф|нод/i);
  });

  it('guide экономит токены: wizard без tools, cron в prompt skill, MCP refresh только для mcp', () => {
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/wizard[\s\S]{0,200}без\s+tool|не\s+вызывай\s+tool/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/крон|cron|автообнов/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(
      /skill|agent|rule|pawn[\s\S]{0,120}prompt|в\s+prompt/i,
    );
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(
      /не\s+создавай\s+MCP|не\s+пиши\s+MCP|без\s+отдельного\s+MCP/i,
    );
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(
      /layercoopRefresh[\s\S]{0,80}только.*mcp|только\s+для\s+mcp/i,
    );
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(/save:home|место\s+сохранения/i);
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(
      /не\s+пиши[\s\S]{0,60}чужой|запрещено[\s\S]{0,40}связанн/i,
    );
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(
      /focus|текущ(ей|ую)\s+нод|существующ/i,
    );
    expect(ARTIFACT_GENERATION_GUIDE).toMatch(
      /не\s+создавай\s+нов|правь\s+только|только\s+файл/i,
    );
  });

  it('stubs явно привязаны к архитектуре Layercoop', () => {
    const skill = generateArtifactStub('skill', 'Jira Analyst', 'анализ Jira');
    expect(skill).toContain('.layercoop/skills/jira-analyst/SKILL.md');
    expect(skill).toMatch(/Layercoop|архитектур/i);
    expect(skill).not.toMatch(/\.cursor\/skills/);

    const agent = generateArtifactStub('agent', 'Reviewer', 'код-ревью');
    expect(agent).toContain('.layercoop/agents/reviewer.md');
    expect(agent).toMatch(/Layercoop|архитектур/i);

    const rule = generateArtifactStub('rule', 'TDD', 'всегда TDD');
    expect(rule).toContain('.layercoop/rules/tdd.mdc');
    expect(rule).toMatch(/Layercoop|архитектур/i);

    const mcp = generateArtifactStub('mcp', 'Corp Jira', 'jira mcp');
    expect(mcp).toContain('mcpServers');
    expect(mcp).toContain('corp-jira');
  });

  it('system prompt GOD требует генерировать артефакты только под архитектуру Layercoop', () => {
    const graph: LayercoopGraph = {
      id: 'g1',
      name: 't',
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [
        {
          id: GOD_NODE_ID,
          type: 'god',
          position: { x: 0, y: 0 },
          data: defaultGodData(),
        },
      ],
      edges: [],
    };

    const { systemPrompt } = composeChatContext(graph, 'создай skill для Jira');
    expect(systemPrompt).toContain(layercoopArchitecturePromptBlock().slice(0, 40));
    expect(systemPrompt).toMatch(/генерир|создава/i);
    expect(systemPrompt).toContain('SKILL.md');
    expect(systemPrompt).toContain('mcpServers');
    expect(systemPrompt).toMatch(/frontmatter|YAML|---/i);
  });
});
