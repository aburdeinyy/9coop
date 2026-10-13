import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { GraphService } from '../../core/services/graph.service';
import { renderChatMarkdown } from '../../core/utils/chat-markdown';
import {
  ARTIFACT_KIND_ICONS,
  ARTIFACT_KIND_LABELS,
  ArtifactNodeData,
  GOD_NODE_ID,
  RUNNER_LABELS,
  RunnerId,
  PAWN_RUNNERS,
  isArtifactData,
  isGodData,
  normalizeGodData,
  normalizePawnLlm,
} from '../../core/models/graph.model';
import { isDefaultArtifactLabel } from '../../core/utils/infer-artifact-kind';
import { isPrimaryGod } from '../../core/utils/god-nodes';
import {
  RUNNER_PRESETS,
  applyRunnerPreset,
  bridgeBase,
  cursorEffortParam,
  cursorFastParam,
  fetchCursorModels,
  fetchOpenAiCompatibleModels,
  parseCursorModelSelection,
  selectCursorModel,
  setCursorModelParam,
  usesCursorApi,
  usesOpenAiCompatibleApi,
  withCurrentCursorModel,
  type CursorModelOption,
} from '../../core/runtime/llm-provider';
import { DEFAULT_OPENCODE_BASE_URL } from '../../core/runtime/local-runners';
import {
  extractDeclaredMcpTools,
  mcpServerStatusFromArtifact,
  redactMcpArtifactForDisplay,
  type McpServerStatus,
} from '../../core/utils/mcp-tools';
import { NodeViewRenderComponent } from '../node-view/node-view-render.component';
import { RuntimeService } from '../../core/services/runtime.service';
import { RepoGitService } from '../../core/services/repo-git.service';
import { listConnectedArtifacts } from '../../core/utils/graph-links';
import { resolveConnectedRepos } from '../../core/utils/resolve-repos';

const RUNNERS = Object.keys(RUNNER_LABELS) as RunnerId[];
const OPENCODE_PLACEHOLDER = DEFAULT_OPENCODE_BASE_URL;
const MODELS_DEBOUNCE_MS = 500;

@Component({
  selector: 'app-node-chat-bubble',
  imports: [NodeViewRenderComponent],
  templateUrl: './node-chat-bubble.component.html',
  styleUrl: './node-chat-bubble.component.scss',
})
export class NodeChatBubbleComponent implements OnDestroy {
  protected readonly graphService = inject(GraphService);
  protected readonly runtime = inject(RuntimeService);
  protected readonly repoGit = inject(RepoGitService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly kindIcons = ARTIFACT_KIND_ICONS;
  protected readonly kindLabels = ARTIFACT_KIND_LABELS;
  protected readonly runnerLabels = RUNNER_LABELS;
  protected readonly runners = RUNNERS;
  protected readonly pawnRunners = PAWN_RUNNERS;
  protected readonly opencodePlaceholder = OPENCODE_PLACEHOLDER;
  protected readonly primaryGodId = GOD_NODE_ID;

  protected readonly availableModels = signal<string[]>([]);
  protected readonly cursorCatalog = signal<CursorModelOption[]>([]);
  protected readonly modelsLoading = signal(false);
  protected readonly modelsError = signal('');

  private modelsTimer: ReturnType<typeof setTimeout> | null = null;
  private modelsFetchGen = 0;

  constructor() {
    effect(() => {
      const s = this.selected();
      if (!s) {
        this.resetModels();
        return;
      }

      if (s.type === 'god' && s.god) {
        if (this.needsEndpoint(s.god.runner)) {
          this.scheduleModelsFetch(s.god.baseUrl, s.god.apiKey, s.god.apiKeyEnv);
          return;
        }
        if (this.isCursor(s.god.runner)) {
          this.scheduleCursorModelsFetch(s.god.apiKey, bridgeBase(s.god));
          return;
        }
      }

      if (s.type === 'artifact' && s.artifact?.kind === 'pawn' && s.artifact.llm) {
        if (this.needsEndpoint(s.artifact.llm.runner)) {
          this.scheduleModelsFetch(s.artifact.llm.baseUrl, s.artifact.llm.apiKey);
          return;
        }
        if (this.isCursor(s.artifact.llm.runner)) {
          this.scheduleCursorModelsFetch(
            s.artifact.llm.apiKey,
            bridgeBase({
              label: '',
              runner: 'cursor',
              model: s.artifact.llm.model,
              baseUrl: s.artifact.llm.baseUrl,
              apiKey: s.artifact.llm.apiKey,
              temperature: s.artifact.llm.temperature,
              isolated: false,
            }),
          );
          return;
        }
      }

      this.resetModels();
    });

    effect(() => {
      const s = this.selected();
      if (s?.type === 'artifact' && s.artifact?.kind === 'repo') {
        void this.repoGit.refreshNode(s.id);
      }
    });
  }

  protected readonly isCwdRepo = computed(() => {
    const s = this.selected();
    if (!s || s.type !== 'artifact' || s.artifact?.kind !== 'repo') return false;
    return resolveConnectedRepos(this.graphService.graph()).nodes[0]?.id === s.id;
  });

  onRepoPath(event: Event): void {
    const s = this.selected();
    if (!s || s.type !== 'artifact') return;
    this.graphService.updateRepoPath(s.id, (event.target as HTMLInputElement).value);
  }

  refreshRepo(): void {
    const s = this.selected();
    if (!s || s.type !== 'artifact') return;
    void this.repoGit.refreshNode(s.id);
  }

  ngOnDestroy(): void {
    if (this.modelsTimer) clearTimeout(this.modelsTimer);
    this.modelsFetchGen += 1;
  }

  protected readonly selected = computed(() => {
    const id = this.graphService.selectedNodeId();
    if (!id) return null;
    const node = this.graphService.graph().nodes.find((n) => n.id === id);
    if (!node) return null;
    if (node.type === 'god' && isGodData(node.data)) {
      return { id, type: 'god' as const, god: normalizeGodData(node.data), artifact: null };
    }
    if (node.type === 'artifact' && isArtifactData(node.data)) {
      const artifact = node.data as ArtifactNodeData;
      return {
        id,
        type: 'artifact' as const,
        god: null,
        artifact:
          artifact.kind === 'pawn'
            ? { ...artifact, llm: normalizePawnLlm(artifact.llm) }
            : artifact,
      };
    }
    return null;
  });

  protected readonly title = computed(() => {
    const s = this.selected();
    if (!s) return '';
    if (s.type === 'god') return s.god!.label;
    return s.artifact!.label;
  });

  protected promptHtml(prompt: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderChatMarkdown(prompt));
  }

  protected readonly cursorModels = computed(() =>
    withCurrentCursorModel(this.cursorCatalog(), this.currentModel()),
  );

  protected readonly cursorSelectedModel = computed(() => {
    const baseId = parseCursorModelSelection(this.currentModel()).id;
    return this.cursorModels().find((model) => model.id === baseId) ?? null;
  });

  protected readonly cursorEffort = computed(() => cursorEffortParam(this.cursorSelectedModel()));

  protected readonly cursorFast = computed(() => cursorFastParam(this.cursorSelectedModel()));

  protected readonly cursorEffortValue = computed(() => {
    const effort = this.cursorEffort();
    if (!effort) return '';
    const selected = parseCursorModelSelection(this.currentModel());
    return (
      selected.params?.find((param) => param.id === effort.id)?.value ??
      this.cursorSelectedModel()?.defaultParams?.find((param) => param.id === effort.id)?.value ??
      effort.values[0]?.value ??
      ''
    );
  });

  protected readonly cursorFastOn = computed(() => {
    const selected = parseCursorModelSelection(this.currentModel());
    return selected.params?.find((param) => param.id === 'fast')?.value === 'true';
  });

  protected cursorModelBase(raw: string): string {
    return parseCursorModelSelection(raw).id;
  }

  protected readonly modelOptions = computed(() => {
    const models = this.availableModels();
    const current = this.currentModel();
    if (!current || models.includes(current)) return models;
    return [current, ...models];
  });

  /** Tools declared in selected skill/mcp artifact text. */
  protected readonly declaredTools = computed(() => {
    const s = this.selected();
    if (s?.type !== 'artifact' || !s.artifact) return [] as string[];
    if (s.artifact.kind !== 'mcp' && s.artifact.kind !== 'skill') return [];
    return extractDeclaredMcpTools(s.artifact.artifactContent, s.artifact.prompt);
  });

  protected readonly mcpServers = computed((): McpServerStatus[] => {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'mcp') return [];
    return mcpServerStatusFromArtifact(s.artifact.artifactContent);
  });

  protected readonly mcpPreview = computed(() => {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'mcp' || !s.artifact.artifactContent) {
      return '';
    }
    return redactMcpArtifactForDisplay(s.artifact.artifactContent);
  });

  /** GOD: connected nodes + MCP servers/tools for the next chat run. */
  protected readonly godRunMcp = computed(() => {
    const s = this.selected();
    if (s?.type !== 'god') return null;
    const g = this.graphService.graph();
    const nodes = listConnectedArtifacts(g);
    const connectedIds = new Set(nodes.map((n) => n.id));
    const artifacts = g.nodes.filter(
      (n) => n.type === 'artifact' && connectedIds.has(n.id) && isArtifactData(n.data),
    );
    const servers = artifacts
      .filter((n) => isArtifactData(n.data) && n.data.kind === 'mcp')
      .flatMap((n) =>
        isArtifactData(n.data) ? mcpServerStatusFromArtifact(n.data.artifactContent) : [],
      );
    const tools = extractDeclaredMcpTools(
      ...artifacts.map((n) => (isArtifactData(n.data) ? n.data.artifactContent : '')),
    );
    return { nodes, servers, tools };
  });

  protected readonly neighbors = computed(() => {
    const s = this.selected();
    if (!s) return [];
    return this.graphService.neighborsOf(s.id);
  });

  needsEndpoint(runner: RunnerId): boolean {
    return usesOpenAiCompatibleApi(runner);
  }

  needsCursorKey(runner: RunnerId): boolean {
    return usesCursorApi(runner);
  }

  isClaudeCode(runner: RunnerId): boolean {
    return runner === 'claude-code';
  }

  isOpencode(runner: RunnerId): boolean {
    return runner === 'opencode';
  }

  isCursor(runner: RunnerId): boolean {
    return runner === 'cursor';
  }

  modelPlaceholder(runner: RunnerId): string {
    if (runner === 'claude-code') return 'claude-opus-5';
    if (runner === 'opencode') return 'anthropic/claude-opus-5';
    return 'auto';
  }

  isPrimaryGodNode(nodeId: string): boolean {
    return isPrimaryGod(nodeId);
  }

  onIsolated(event: Event): void {
    this.patchGod({ isolated: (event.target as HTMLInputElement).checked });
  }

  isConnected(nodeId: string): boolean {
    return this.graphService.isConnected(nodeId);
  }

  isDirectlyLinkedToGod(nodeId: string): boolean {
    return this.graphService.isDirectlyLinkedToGod(nodeId);
  }

  close(): void {
    this.graphService.cancelLink();
    this.graphService.dismissSettings();
  }

  connect(): void {
    const s = this.selected();
    if (!s) return;
    if (s.type === 'artifact' || (s.type === 'god' && !isPrimaryGod(s.id))) {
      this.graphService.connectToGod(s.id);
    }
  }

  disconnect(): void {
    const s = this.selected();
    if (!s) return;
    if (s.type === 'artifact' || (s.type === 'god' && !isPrimaryGod(s.id))) {
      this.graphService.disconnectFromGod(s.id);
    }
  }

  unlinkNeighbor(otherId: string): void {
    const s = this.selected();
    if (s) this.graphService.unlinkNodes(s.id, otherId);
  }

  remove(): void {
    const s = this.selected();
    if (!s) return;
    if (s.type === 'artifact' || (s.type === 'god' && !isPrimaryGod(s.id))) {
      this.graphService.removeArtifactNode(s.id);
    }
  }

  /** Черновик «Новая нода» → саб-GOD с полями Base URL / API key / model. */
  convertToSubGod(): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || !s.artifact) return;
    const label = isDefaultArtifactLabel(s.artifact.label) ? 'OpenWebUI' : s.artifact.label;
    this.graphService.promoteArtifactToGod(
      s.id,
      {
        label,
        runner: 'openai-compatible',
        model: 'deepseek-chat',
        baseUrl: '',
      },
      true,
    );
  }

  isDraftArtifact(): boolean {
    const s = this.selected();
    if (s?.type !== 'artifact' || !s.artifact) return false;
    if (s.artifact.kind === 'repo') return false;
    return isDefaultArtifactLabel(s.artifact.label) || !s.artifact.prompt.trim();
  }

  clearView(): void {
    const s = this.selected();
    if (s?.type === 'artifact') this.graphService.clearNodeView(s.id);
  }

  refreshView(): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || !s.artifact?.prompt.trim()) return;
    void this.runtime.run(s.artifact.prompt, s.id);
  }

  onToggleChecklist(itemId: string): void {
    const s = this.selected();
    if (s?.type === 'artifact') this.graphService.toggleChecklistItem(s.id, itemId);
  }

  onAddChecklist(text: string): void {
    const s = this.selected();
    if (s?.type === 'artifact') this.graphService.addChecklistItem(s.id, text);
  }

  onRemoveChecklist(itemId: string): void {
    const s = this.selected();
    if (s?.type === 'artifact') this.graphService.removeChecklistItem(s.id, itemId);
  }

  onArtifactLabel(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact') return;
    this.graphService.updateNodeLabel(s.id, (event.target as HTMLInputElement).value);
  }

  onPipeToggle(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'skill') return;
    this.graphService.setArtifactPipe(s.id, (event.target as HTMLInputElement).checked);
  }

  onPawnRunner(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn' || !s.artifact.llm) return;
    const runner = (event.target as HTMLSelectElement).value as RunnerId;
    const preset = RUNNER_PRESETS[runner];
    this.graphService.updatePawnLlm(s.id, {
      runner,
      model: preset.model,
      baseUrl: preset.baseUrl,
    });
  }

  onPawnModel(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn') return;
    this.graphService.updatePawnLlm(s.id, {
      model: (event.target as HTMLInputElement | HTMLSelectElement).value,
    });
  }

  onPawnCursorModel(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn') return;
    this.graphService.updatePawnLlm(s.id, {
      model: selectCursorModel(
        (event.target as HTMLSelectElement).value,
        this.currentModel(),
        this.cursorCatalog(),
      ),
    });
  }

  onPawnCursorEffort(event: Event): void {
    const s = this.selected();
    const effort = this.cursorEffort();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn' || !effort) return;
    this.graphService.updatePawnLlm(s.id, {
      model: setCursorModelParam(
        this.currentModel(),
        effort.id,
        (event.target as HTMLSelectElement).value,
      ),
    });
  }

  onPawnCursorFast(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn') return;
    const on = (event.target as HTMLInputElement).checked;
    this.graphService.updatePawnLlm(s.id, {
      model: setCursorModelParam(this.currentModel(), 'fast', on ? 'true' : 'false'),
    });
  }

  onPawnBaseUrl(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn') return;
    this.graphService.updatePawnLlm(s.id, { baseUrl: (event.target as HTMLInputElement).value });
  }

  onPawnApiKey(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn') return;
    this.graphService.updatePawnLlm(s.id, { apiKey: (event.target as HTMLInputElement).value });
  }

  onPawnTemperature(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'artifact' || s.artifact?.kind !== 'pawn') return;
    const value = Number((event.target as HTMLInputElement).value);
    this.graphService.updatePawnLlm(s.id, {
      temperature: Number.isFinite(value) ? value : 0.2,
    });
  }

  onGodLabel(event: Event): void {
    this.patchGod({ label: (event.target as HTMLInputElement).value });
  }

  onRunner(event: Event): void {
    const s = this.selected();
    if (s?.type !== 'god' || !s.god) return;
    const runner = (event.target as HTMLSelectElement).value as RunnerId;
    this.patchGod(applyRunnerPreset(s.god, runner));
  }

  onModel(event: Event): void {
    this.patchGod({
      model: (event.target as HTMLInputElement | HTMLSelectElement).value,
    });
  }

  onCursorModel(event: Event): void {
    const modelId = (event.target as HTMLSelectElement).value;
    this.applyModel(selectCursorModel(modelId, this.currentModel(), this.cursorCatalog()));
  }

  onCursorEffort(event: Event): void {
    const effort = this.cursorEffort();
    if (!effort) return;
    this.applyModel(
      setCursorModelParam(this.currentModel(), effort.id, (event.target as HTMLSelectElement).value),
    );
  }

  onCursorFast(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.applyModel(setCursorModelParam(this.currentModel(), 'fast', on ? 'true' : 'false'));
  }

  onBaseUrl(event: Event): void {
    this.patchGod({ baseUrl: (event.target as HTMLInputElement).value });
  }

  onApiKey(event: Event): void {
    this.patchGod({ apiKey: (event.target as HTMLInputElement).value });
  }

  onApiKeyEnv(event: Event): void {
    this.patchGod({ apiKeyEnv: (event.target as HTMLInputElement).value.trim() });
  }

  onTemperature(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.patchGod({
      temperature: Number.isFinite(value) ? value : 0.2,
    });
  }

  private currentModel(): string {
    const s = this.selected();
    if (s?.type === 'god' && s.god) return s.god.model;
    if (s?.type === 'artifact' && s.artifact?.kind === 'pawn' && s.artifact.llm) {
      return s.artifact.llm.model;
    }
    return '';
  }

  private resetModels(): void {
    if (this.modelsTimer) {
      clearTimeout(this.modelsTimer);
      this.modelsTimer = null;
    }
    this.modelsFetchGen += 1;
    this.availableModels.set([]);
    this.cursorCatalog.set([]);
    this.modelsLoading.set(false);
    this.modelsError.set('');
  }

  private scheduleModelsFetch(baseUrl: string, apiKey: string, apiKeyEnv = ''): void {
    if (this.modelsTimer) clearTimeout(this.modelsTimer);

    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();
    const trimmedEnv = apiKeyEnv.trim();

    // Ждём URL и ключ (прямой или имя из Secrets) — прелоадер ещё не показываем.
    if (!trimmedUrl || (!trimmedKey && !trimmedEnv)) {
      this.modelsFetchGen += 1;
      this.availableModels.set([]);
      this.modelsLoading.set(false);
      this.modelsError.set('');
      return;
    }

    this.modelsLoading.set(false);
    this.modelsError.set('');
    const gen = ++this.modelsFetchGen;

    this.modelsTimer = setTimeout(() => {
      if (gen !== this.modelsFetchGen) return;
      this.modelsLoading.set(true);
      this.availableModels.set([]);
      void this.loadModels(trimmedUrl, trimmedKey, gen, trimmedEnv);
    }, MODELS_DEBOUNCE_MS);
  }

  private scheduleCursorModelsFetch(apiKey: string, bridge: string): void {
    if (this.modelsTimer) clearTimeout(this.modelsTimer);

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      this.modelsFetchGen += 1;
      this.cursorCatalog.set([]);
      this.modelsLoading.set(false);
      this.modelsError.set('');
      return;
    }

    this.modelsLoading.set(false);
    this.modelsError.set('');
    const gen = ++this.modelsFetchGen;

    this.modelsTimer = setTimeout(() => {
      if (gen !== this.modelsFetchGen) return;
      this.modelsLoading.set(true);
      this.cursorCatalog.set([]);
      void this.loadCursorModels(trimmedKey, bridge, gen);
    }, MODELS_DEBOUNCE_MS);
  }

  private async loadCursorModels(apiKey: string, bridge: string, gen: number): Promise<void> {
    try {
      const models = await fetchCursorModels(apiKey, { bridgeBase: bridge });
      if (gen !== this.modelsFetchGen) return;
      this.cursorCatalog.set(models);
      this.modelsLoading.set(false);
      this.modelsError.set(models.length ? '' : 'Список моделей пуст');
    } catch (err) {
      if (gen !== this.modelsFetchGen) return;
      this.cursorCatalog.set([]);
      this.modelsLoading.set(false);
      this.modelsError.set(err instanceof Error ? err.message : 'Не удалось загрузить модели');
    }
  }

  private async loadModels(
    baseUrl: string,
    apiKey: string,
    gen: number,
    apiKeyEnv = '',
  ): Promise<void> {
    try {
      const models = await fetchOpenAiCompatibleModels(baseUrl, apiKey, {
        ...(apiKeyEnv ? { apiKeyEnv } : {}),
      });
      if (gen !== this.modelsFetchGen) return;
      this.availableModels.set(models);
      this.modelsLoading.set(false);
      this.modelsError.set(models.length ? '' : 'Список моделей пуст');

      const current = this.currentModel();
      if (!current && models.length > 0) {
        this.applyModel(models[0]!);
      }
    } catch (err) {
      if (gen !== this.modelsFetchGen) return;
      this.availableModels.set([]);
      this.modelsLoading.set(false);
      this.modelsError.set(err instanceof Error ? err.message : 'Не удалось загрузить модели');
    }
  }

  private applyModel(model: string): void {
    const s = this.selected();
    if (s?.type === 'god') {
      this.patchGod({ model });
      return;
    }
    if (s?.type === 'artifact' && s.artifact?.kind === 'pawn') {
      this.graphService.updatePawnLlm(s.id, { model });
    }
  }

  private patchGod(patch: Parameters<GraphService['updateGodConfig']>[0]): void {
    const s = this.selected();
    if (s?.type !== 'god') return;
    this.graphService.updateGodConfig(patch, s.id);
  }
}
