import {
  isArtifactData,
  type LayercoopGraph,
} from '../models/graph.model';

export type PipeSkillRef = {
  id: string;
  label: string;
  prompt: string;
  artifactPath?: string;
  artifactContent?: string;
};

/**
 * Пайпы: skill с галочкой `pipe` в настройках.
 * Сортировка по label. Рёбра не важны — можно линковать к GOD или нет.
 */
export function listPipeSkills(graph: LayercoopGraph): PipeSkillRef[] {
  const out: PipeSkillRef[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'artifact' || !isArtifactData(node.data)) continue;
    if (node.data.kind !== 'skill') continue;
    if (node.data.pipe !== true) continue;
    out.push({
      id: node.id,
      label: node.data.label,
      prompt: node.data.prompt,
      artifactPath: node.data.artifactPath,
      artifactContent: node.data.artifactContent,
    });
  }
  return out.sort(
    (a, b) => a.label.localeCompare(b.label, 'ru') || a.id.localeCompare(b.id),
  );
}

/** Пайп про MR/GitLab — после create нужен spawn list со статусами pipeline. */
export function pipeLooksLikeGitlabMr(
  pipe: Pick<PipeSkillRef, 'label' | 'prompt'>,
): boolean {
  const hay = `${pipe.label} ${pipe.prompt}`.toLowerCase();
  return /gitlab|git\s*lab|\bmr\b|merge\s*request|мердж|мр\b/.test(hay);
}

/** User-сообщение в чат focus-ноды при запуске пайпа. */
export function buildPipeRunPrompt(
  pipe: Pick<PipeSkillRef, 'label' | 'prompt'>,
  focusLabel: string,
): string {
  const focus = focusLabel.trim() || 'текущей ноды';
  const lines = [
    `Запусти пайп «${pipe.label}» для ноды «${focus}».`,
    'Следуй спеке пайпа (она в контексте рана как явно вызванный skill).',
    'Опирайся на историю чата и спеку этой ноды; MCP/tools — из подключённых к GOD.',
    pipe.prompt.trim()
      ? `Кратко цель пайпа: ${pipe.prompt.trim().slice(0, 240)}`
      : '',
  ];
  if (pipeLooksLikeGitlabMr(pipe)) {
    lines.push(
      'После успешного создания MR обязательно в КОНЦЕ ответа fence ```layercoop-view с type:"list", spawn:true, title «MR !<iid> pipeline», items: Approval (text=«Approval», meta=approved|unapproved|approvals: N/M) + jobs (text=name, meta=success|failed|running|pending|…, href=url). meta — машинный статус для иконок. Не ограничивайся текстом в чате — нужна отдельная плитка на доске (UI поставит крон 15с).',
    );
  }
  return lines.filter(Boolean).join('\n');
}
