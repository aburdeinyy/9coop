import type { ArtifactKind, ExportFile, LayercoopGraph, PawnLlmConfig } from '../models/graph.model';
import {
  ARTIFACT_KIND_LABELS,
  RUNNER_LABELS,
  normalizeGodData,
  slugify,
  stripPawnSecrets,
} from '../models/graph.model';
import { stripGodSecrets } from '../runtime/llm-provider';
import {
  LAYERCOOP_DIR,
  architectureNoteForPath,
} from './layercoop-architecture';
import { scrubMcpSecretsInContent } from './dotenv-format';
import {
  buildLayercoopRefreshSource,
  parseAutoRefresh,
} from './auto-refresh';

export { LAYERCOOP_DIR };

export function defaultArtifactPath(kind: ArtifactKind, label: string): string {
  const s = slugify(label);
  switch (kind) {
    case 'skill':
      return `${LAYERCOOP_DIR}/skills/${s}/SKILL.md`;
    case 'mcp':
      return `${LAYERCOOP_DIR}/mcp.d/${s}.json`;
    case 'agent':
    case 'pawn':
      return `${LAYERCOOP_DIR}/agents/${s}.md`;
    case 'rule':
      return `${LAYERCOOP_DIR}/rules/${s}.mdc`;
    case 'repo':
      return `${LAYERCOOP_DIR}/repos/${s}.md`;
  }
}

/** Старые пути `.cursor/` → `.layercoop/`. */
export function relocateArtifactPath(path: string): string {
  if (path.startsWith('.cursor/')) return `${LAYERCOOP_DIR}/${path.slice('.cursor/'.length)}`;
  if (path === 'layercoop.graph.json') return `${LAYERCOOP_DIR}/graph.json`;
  return path;
}

export function generateArtifactStub(
  kind: ArtifactKind,
  label: string,
  prompt: string,
  llm?: PawnLlmConfig,
): string {
  const s = slugify(label);
  const path = defaultArtifactPath(kind, label);
  switch (kind) {
    case 'skill':
      return `---
name: ${s}
description: ${prompt}
---

# ${label}

${architectureNoteForPath(path)}

## Архитектура
Это skill-нода Layercoop-графа (GOD-оркестрация), не Cursor IDE skill.
Экспорт: \`${path}\`. Подключай к GOD; опирайся на MCP/pawn графа.

## Цель
${prompt}

## Workflow

1. Опиши цель пользователя в рамках этой skill-ноды.
2. Используй только подключённые MCP/tools графа Layercoop.
3. Верни результат в markdown, пригодный для чата GOD.
`;
    case 'mcp': {
      const auto = parseAutoRefresh(prompt);
      const body: Record<string, unknown> = {
        mcpServers: {
          [s]: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-everything'],
            env: {},
          },
        },
      };
      if (auto) {
        body['layercoopRefresh'] = {
          intervalMs: auto.intervalMs,
          server: s,
          source: buildLayercoopRefreshSource(label, 'refresh'),
        };
      }
      return JSON.stringify(body, null, 2);
    }
    case 'agent':
      return `# ${label}

> ${prompt}

${architectureNoteForPath(path)}

## Архитектура
Agent-нода Layercoop: GOD делегирует ей задачи по роли ниже. Не ambient Cursor agent.

## Role
Специализированный агент для: ${label}

## Instructions
${prompt}
`;
    case 'pawn': {
      const runner = llm?.runner ?? 'openai-compatible';
      const model = llm?.model?.trim() || '(model unset)';
      const baseUrl = llm?.baseUrl?.trim() || '(baseUrl unset)';
      return `# ${label} (Pawn / auxiliary LLM)

> ${prompt}

${architectureNoteForPath(path)}

## Архитектура
Pawn — вспомогательная LLM-нода графа Layercoop для делегирования от GOD (не путать с GOD).

## Role
Вспомогательная LLM-нода (pawn) для делегирования задач от GOD-оркестратора.

## Endpoint (без секретов)
- Runner: ${RUNNER_LABELS[runner]} (\`${runner}\`)
- Model: \`${model}\`
- Base URL: \`${baseUrl}\`

## Instructions
${prompt || 'Выполняй delegated-задачи в рамках своей роли.'}

## Usage
GOD / Cursor local runtime может вызывать этот pawn как агента для задач, подходящих под роль выше.
`;
    }
    case 'rule':
      return `---
description: ${prompt}
alwaysApply: false
---

# ${label}

${architectureNoteForPath(path)}

## Архитектура
Rule-нода Layercoop (не Cursor IDE \`.cursor/rules\`). Применяется в контексте GOD-графа.

${prompt}
`;
    case 'repo':
      return `# ${label} (Repository)

> Локальный git-репозиторий для правок GOD / саб-GOD.

Путь задаётся в UI ноды (\`repoPath\`). Не экспортируется как skill/mcp.
`;
  }
}

export interface ExportBundle {
  files: ExportFile[];
  mcpMergePatch?: Record<string, unknown>;
}

export function buildExportBundle(graph: LayercoopGraph): ExportBundle {
  const safeGraph: LayercoopGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type === 'god') {
        return { ...node, data: stripGodSecrets(normalizeGodData(node.data)) };
      }
      if (node.type === 'artifact' && 'kind' in node.data) {
        return { ...node, data: stripPawnSecrets(node.data) };
      }
      return node;
    }),
  };
  const files: ExportFile[] = [
    { path: `${LAYERCOOP_DIR}/graph.json`, content: JSON.stringify(safeGraph, null, 2) },
  ];
  const mcpServers: Record<string, unknown> = {};

  for (const node of graph.nodes) {
    if (node.type !== 'artifact') continue;
    const data = node.data;
    if (!('kind' in data)) continue;

    const path = relocateArtifactPath(
      data.artifactPath ?? defaultArtifactPath(data.kind, data.label),
    );
    const contentRaw =
      data.artifactContent ??
      generateArtifactStub(data.kind, data.label, data.prompt, data.llm);
    const content = data.kind === 'mcp' ? scrubMcpSecretsInContent(contentRaw) : contentRaw;
    files.push({ path, content });

    if (data.kind === 'mcp') {
      try {
        const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
        Object.assign(mcpServers, parsed.mcpServers ?? {});
      } catch {
        // skip
      }
    }
  }

  files.push({ path: `${LAYERCOOP_DIR}/README.md`, content: buildReadme(graph) });

  if (Object.keys(mcpServers).length > 0) {
    files.push({
      path: `${LAYERCOOP_DIR}/mcp.json`,
      content: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  return {
    files,
    mcpMergePatch: Object.keys(mcpServers).length > 0 ? { mcpServers } : undefined,
  };
}

function buildReadme(graph: LayercoopGraph): string {
  const artifacts = graph.nodes.filter((n) => n.type === 'artifact');
  const lines = [
    '# Layercoop Export',
    '',
    `Graph: **${graph.name}**`,
    '',
    '## Артефакты',
    '',
    ...artifacts.map((node) => {
      const data = node.data as { kind: ArtifactKind; label: string; prompt: string };
      return `- **${data.label}** (${ARTIFACT_KIND_LABELS[data.kind]}): ${data.prompt}`;
    }),
    '',
    '## Установка',
    '',
    '1. Скопируйте `.layercoop/` в корень вашего проекта.',
    '2. Откройте `.layercoop/graph.json` в Layercoop для редактирования графа.',
    '3. MCP-конфиг лежит в `.layercoop/mcp.json` (не в `.cursor/`).',
    '4. Секреты — в корневом `.env` (UI Secrets), не в артефактах.',
    '',
  ];
  return lines.join('\n');
}

export async function downloadZip(files: ExportFile[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
