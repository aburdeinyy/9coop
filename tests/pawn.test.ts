import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_KIND_ICONS,
  ARTIFACT_KIND_LABELS,
  defaultPawnLlm,
  normalizeArtifactData,
  type ArtifactNodeData,
} from '../src/app/core/models/graph.model';
import { composeChatContext } from '../src/app/core/utils/compose-context';
import {
  buildExportBundle,
  defaultArtifactPath,
  generateArtifactStub,
} from '../src/app/core/utils/export-artifacts';
import { buildRuntimePlan } from '../src/app/core/runtime/runtime-plan';
import { GOD_NODE_ID, type GraphNode, type LayercoopGraph } from '../src/app/core/models/graph.model';

const godNode: GraphNode = {
  id: GOD_NODE_ID,
  type: 'god',
  position: { x: 0, y: 0 },
  data: { label: 'Cursor' },
};

describe('pawn model', () => {
  it('есть kind pawn с иконкой и лейблом', () => {
    expect(ARTIFACT_KIND_LABELS.pawn).toBe('Pawn');
    expect(ARTIFACT_KIND_ICONS.pawn).toBeTruthy();
  });

  it('defaultPawnLlm — openai-compatible для corp LLM', () => {
    const llm = defaultPawnLlm();
    expect(llm.runner).toBe('openai-compatible');
    expect(llm.apiKey).toBe('');
  });

  it('normalizeArtifactData дописывает llm для pawn', () => {
    const raw = {
      kind: 'pawn',
      label: 'Corp',
      prompt: 'Корпоративный аналитик',
      connected: false,
    };
    const data = normalizeArtifactData(raw);
    expect(data.kind).toBe('pawn');
    expect(data.llm?.runner).toBe('openai-compatible');
  });
});

describe('pawn в графе', () => {
  function graphWithPawn(connected = true): LayercoopGraph {
    const pawn: GraphNode = {
      id: 'pawn-corp',
      type: 'artifact',
      position: { x: 200, y: 0 },
      data: {
        kind: 'pawn',
        label: 'Corp LLM',
        prompt: 'Корпоративный агент для Jira/Confluence',
        connected,
        llm: {
          runner: 'openai-compatible',
          model: 'corp-gpt',
          baseUrl: 'https://llm.corp.example/v1',
          apiKey: 'secret-key',
          temperature: 0.1,
        },
      },
    };
    return {
      version: 1,
      name: 'demo',
      updatedAt: '2026-09-03T00:00:00.000Z',
      nodes: [godNode, pawn],
      edges: connected
        ? [{ id: 'edge-pawn-corp', source: GOD_NODE_ID, target: 'pawn-corp' }]
        : [],
    };
  }

  it('composeChatContext описывает pawn без apiKey', () => {
    const ctx = composeChatContext(graphWithPawn(), 'используй corp агента');
    expect(ctx.connectedArtifacts).toHaveLength(1);
    expect(ctx.connectedArtifacts[0].kind).toBe('pawn');
    expect(ctx.systemPrompt).toMatch(/Pawn|вспомогательн/i);
    expect(ctx.systemPrompt).toContain('Corp LLM');
    expect(ctx.systemPrompt).toContain('corp-gpt');
    expect(ctx.systemPrompt).toContain('https://llm.corp.example/v1');
    expect(ctx.systemPrompt).not.toContain('secret-key');
  });

  it('export pawn → .layercoop/agents и без apiKey в graph.json', () => {
    expect(defaultArtifactPath('pawn', 'Corp LLM')).toBe('.layercoop/agents/corp-llm.md');
    const stub = generateArtifactStub('pawn', 'Corp LLM', 'role', {
      runner: 'openai-compatible',
      model: 'corp-gpt',
      baseUrl: 'https://llm.corp.example/v1',
      apiKey: 'secret',
      temperature: 0.1,
    });
    expect(stub).toContain('Corp LLM');
    expect(stub).toContain('corp-gpt');
    expect(stub).not.toContain('secret');

    const bundle = buildExportBundle(graphWithPawn());
    expect(bundle.files.some((f) => f.path === '.layercoop/agents/corp-llm.md')).toBe(true);
    const graphFile = bundle.files.find((f) => f.path === '.layercoop/graph.json');
    expect(graphFile).toBeDefined();
    expect(graphFile!.content).not.toContain('secret-key');
  });

  it('runtime plan включает pawn после agent', () => {
    const plan = buildRuntimePlan(graphWithPawn());
    const kinds = plan.map((s) => s.kind);
    expect(kinds).toContain('pawn');
    expect(kinds.indexOf('pawn')).toBeGreaterThan(kinds.indexOf('god'));
  });
});
