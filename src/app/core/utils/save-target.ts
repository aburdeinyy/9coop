import type { LayercoopGraph } from '../models/graph.model';
import { isArtifactData } from '../models/graph.model';
import type { WizardOption } from './node-wizard';
import {
  resolveConnectedRepos,
  type ConnectedRepo,
  type ResolvedRepos,
} from './resolve-repos';

export const SAVE_HOME_ID = 'save:home';

export type SaveTargetRef =
  | { type: 'home' }
  | { type: 'repo'; repoId: string };

export function saveRepoOptionId(repoNodeId: string): string {
  return `save:repo:${repoNodeId}`;
}

export function parseSaveTargetId(raw: string | undefined | null): SaveTargetRef | null {
  const id = (raw ?? '').trim().toLowerCase();
  if (!id) return null;
  if (id === SAVE_HOME_ID || id === 'home' || id === 'save-home') return { type: 'home' };
  const m = /^save:repo:(.+)$/i.exec(id) || /^repo:(.+)$/i.exec(id);
  if (m?.[1]) return { type: 'repo', repoId: m[1] };
  return null;
}

export function buildSaveTargetOptions(repos: ConnectedRepo[]): WizardOption[] {
  const options: WizardOption[] = [
    {
      id: SAVE_HOME_ID,
      label: 'Layercoop (этот проект оркестрации)',
    },
  ];
  for (const repo of repos) {
    const short = repo.path.split(/[/\\]/).filter(Boolean).pop() || repo.label;
    options.push({
      id: saveRepoOptionId(repo.id),
      label: `${repo.label} · ${short}`,
    });
  }
  return options;
}

/** Абсолютный путь cwd для записи; undefined = каталог bridge (Layercoop home). */
export function resolveSaveRoot(
  target: SaveTargetRef | null | undefined,
  repos: ConnectedRepo[],
): string | undefined {
  if (!target || target.type === 'home') return undefined;
  const hit = repos.find((r) => r.id === target.repoId);
  return hit?.path || undefined;
}

export function formatSaveTargetsPromptBlock(repos: ConnectedRepo[]): string {
  const options = buildSaveTargetOptions(repos);
  if (options.length <= 1) {
    return [
      'Место сохранения артефактов:',
      '- Сейчас нет связанных repo — пиши файлы в каталог Layercoop (cwd bridge), только под `.layercoop/`.',
      `- В wizard done укажи "saveTarget": "${SAVE_HOME_ID}".`,
    ].join('\n');
  }
  const lines = [
    'Место сохранения артефактов (обязательный вопрос wizard, один из шагов):',
    '- Спроси: «Куда сохранить файлы ноды?» и дай РОВНО эти варианты (id не меняй):',
  ];
  for (const opt of options) {
    lines.push(`  - id "${opt.id}" — ${opt.label}`);
  }
  lines.push(
    `- В блоке done обязательно поле "saveTarget": одно из id выше (например "${SAVE_HOME_ID}" или "${options[1]!.id}").`,
    '- Пока saveTarget не выбран — файлы на диск НЕ пиши.',
    `- ${SAVE_HOME_ID} → cwd записи = Layercoop home; относительные \`.layercoop/...\`. ЗАПРЕЩЕНО писать в связанные repo (их пути выше — только чтение).`,
    '- save:repo:… → cwd записи = этот репозиторий; те же относительные пути `.layercoop/...` уже внутри него.',
  );
  return lines.join('\n');
}

/**
 * cwd для Agent / bridge disk MCP:
 * - focus artifact (не repo) с saveRoot → saveRoot
 * - focus artifact без saveRoot → Layercoop home (undefined → bridge process.cwd)
 * - GOD / саб-GOD → Layercoop home (чтобы подхватить `.layercoop/mcp.json`);
 *   репозитории — через MCP repos-fs (корни из repo-нод), не через подмену cwd
 */
export function resolveWorkspaceCwdForFocus(
  graph: LayercoopGraph,
  focusNodeId: string,
  _workspaces: ResolvedRepos = resolveConnectedRepos(graph),
): string | undefined {
  const focus = graph.nodes.find((n) => n.id === focusNodeId);
  if (focus?.type === 'artifact' && isArtifactData(focus.data) && focus.data.kind !== 'repo') {
    const root = focus.data.saveRoot?.trim();
    return root || undefined;
  }
  return undefined;
}
