import {
  Component,
  ElementRef,
  ViewChild,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { DomSanitizer, type SafeHtml } from "@angular/platform-browser";
import { GraphService } from "../../core/services/graph.service";
import { RuntimeService } from "../../core/services/runtime.service";
import {
  GOD_NODE_ID,
  isArtifactData,
  isGodData,
  normalizeGodData,
} from "../../core/models/graph.model";
import { renderChatMarkdown } from "../../core/utils/chat-markdown";
import { connectionStatusLabel } from "../../core/utils/graph-links";
import { materializeViewFenceForChat } from "../../core/utils/node-view";
import {
  extractLayercoopWizard,
  formatWizardPick,
  stripLayercoopWizardFence,
  type WizardOption,
  type WizardQuestion,
} from "../../core/utils/node-wizard";
import { runStepPreview } from "../../core/utils/run-steps";
import type { ChatRunStats, ChatRunStep, ChatTokenUsage } from "../../core/models/graph.model";
import {
  formatRunStatsLabel,
  runStatsBarSegments,
  type RunStatsBarSegment,
} from "../../core/utils/run-stats";
import {
  buildChatHistoryDocument,
  chatHistoryFilename,
  isHistoryCommand,
} from "../../core/utils/chat-history-export";
import { triggerDownload } from "../../core/utils/export-artifacts";
import {
  chatMessagesOf,
  type ChatThread,
} from "../../core/utils/workspace-persist";
import { chatScopeKey } from "../../core/utils/chat-scope";
import {
  CHAT_DRAG_MIME,
  serializeChatDragPayload,
} from "../../core/utils/chat-to-node";

const PROMPT_MAX_HEIGHT_PX = 160;
const PROMPT_MIN_HEIGHT_PX = 28;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

@Component({
  selector: "app-global-chat",
  templateUrl: "./global-chat.component.html",
  styleUrl: "./global-chat.component.scss",
})
export class GlobalChatComponent {
  @ViewChild("messagesEl") private messagesEl?: ElementRef<HTMLElement>;
  @ViewChild("promptEl") private promptEl?: ElementRef<HTMLTextAreaElement>;

  protected readonly graphService = inject(GraphService);
  protected readonly runtime = inject(RuntimeService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly input = signal("");
  /** Черновики инпута: nodeId::threadId → text */
  private readonly drafts = new Map<string, string>();
  private draftScopeKey: string | null = null;

  constructor() {
    effect(() => {
      const nodeId = this.graphService.selectedNodeId();
      const threadId = nodeId ? this.graphService.activeThreadId(nodeId) : null;
      const key = nodeId ? chatScopeKey(nodeId, threadId) : null;
      if (key === this.draftScopeKey) return;
      if (this.draftScopeKey != null) {
        this.drafts.set(this.draftScopeKey, this.input());
      }
      this.draftScopeKey = key;
      this.input.set(key ? (this.drafts.get(key) ?? "") : "");
      queueMicrotask(() => this.resetPromptHeight());
    });

    afterRenderEffect(() => {
      this.graphService.selectedNodeId();
      this.messages();
      this.runtime.runningChatKeys();
      this.scrollToBottom();
    });

    afterRenderEffect(() => {
      this.graphService.chatPromptFocusNonce();
      if (!this.graphService.selectedNodeId()) return;
      queueMicrotask(() => this.promptEl?.nativeElement.focus());
    });
  }

  protected readonly selectedChatRunning = computed(() => {
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId) return false;
    return this.runtime.isChatRunning(nodeId, this.graphService.activeThreadId(nodeId));
  });

  protected readonly headerTitle = computed(() => {
    const id = this.graphService.selectedNodeId();
    if (!id) return "Чат";
    const node = this.graphService.graph().nodes.find((n) => n.id === id);
    if (!node) return "Чат";
    if (node.type === "god" && isGodData(node.data)) {
      return normalizeGodData(node.data).label;
    }
    if (node.type === "artifact" && isArtifactData(node.data)) {
      return node.data.label;
    }
    return "Чат";
  });

  /** Ответ всегда даёт runner GOD-ноды — подписываем её именем. */
  protected readonly assistantLabel = computed(() => {
    const god = this.graphService
      .graph()
      .nodes.find((n) => n.id === GOD_NODE_ID);
    return normalizeGodData(god?.data ?? {}).label;
  });

  protected readonly messages = computed(() =>
    this.graphService.selectedChatMessages(),
  );

  protected readonly threads = computed(() => {
    const id = this.graphService.selectedNodeId();
    return id ? this.graphService.chatThreadsFor(id) : [];
  });

  protected readonly activeThreadId = computed(() => {
    const id = this.graphService.selectedNodeId();
    return id ? this.graphService.activeThreadId(id) : null;
  });

  protected readonly statusLabel = computed(() =>
    connectionStatusLabel(
      this.graphService.graph().nodes.filter((n) => n.type === "artifact").length,
      this.graphService.connectedCount(),
    ),
  );

  protected readonly emptyHint = computed(() => {
    const id = this.graphService.selectedNodeId();
    if (!id) return "Выберите ноду на доске.";
    if (id === GOD_NODE_ID) {
      return "Чат GOD-node. Чтобы создать ноду — опишите задачу.";
    }
    return "Опишите, что должна делать нода.";
  });

  chatHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      renderChatMarkdown(this.chatBody(content)),
    );
  }

  protected chatBody(content: string): string {
    return materializeViewFenceForChat(stripLayercoopWizardFence(content));
  }

  protected wizardOf(content: string): WizardQuestion | null {
    return extractLayercoopWizard(content);
  }

  protected canPickWizard(last: boolean): boolean {
    return last && !this.selectedChatRunning();
  }

  pickWizard(option: WizardOption): void {
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId || this.selectedChatRunning()) return;
    this.graphService.applySaveTargetPick(nodeId, option.id);
    void this.runtime.run(formatWizardPick(option), nodeId);
  }

  onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.input.set(el.value);
    if (this.draftScopeKey) this.drafts.set(this.draftScopeKey, el.value);
    this.autosizePrompt(el);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  submit(): void {
    const nodeId = this.graphService.selectedNodeId();
    const trimmed = this.input().trim();
    if (!nodeId || !trimmed) return;

    const historyFmt = isHistoryCommand(trimmed);
    if (historyFmt) {
      this.input.set("");
      if (this.draftScopeKey) this.drafts.set(this.draftScopeKey, "");
      this.resetPromptHeight();
      this.downloadHistory(nodeId, historyFmt);
      return;
    }

    if (this.selectedChatRunning()) return;
    this.input.set("");
    if (this.draftScopeKey) this.drafts.set(this.draftScopeKey, "");
    this.resetPromptHeight();
    void this.runtime.run(trimmed, nodeId);
  }

  private downloadHistory(nodeId: string, format: "md" | "json"): void {
    const graph = this.graphService.graph();
    const node = graph.nodes.find((n) => n.id === nodeId);
    const state = this.graphService.nodeChats()[nodeId];
    const thread: ChatThread | undefined =
      state?.threads.find((t) => t.id === state.activeThreadId) ?? state?.threads[0];
    const messages = thread?.messages ?? chatMessagesOf(state);

    let nodeLabel = "chat";
    let nodeKind = "unknown";
    let runner: string | undefined;
    let model: string | undefined;
    if (node?.type === "god" && isGodData(node.data)) {
      const g = normalizeGodData(node.data);
      nodeLabel = g.label;
      nodeKind = "god";
      runner = g.runner;
      model = g.model;
    } else if (node?.type === "artifact" && isArtifactData(node.data)) {
      nodeLabel = node.data.label;
      nodeKind = node.data.kind;
    }

    const doc = buildChatHistoryDocument({
      graphName: graph.name,
      nodeId,
      nodeLabel,
      nodeKind,
      threadId: thread?.id ?? "default",
      threadTitle: thread?.title ?? "Чат",
      exportedAt: new Date().toISOString(),
      messages,
      runner,
      model,
    });

    const filename = chatHistoryFilename(
      graph.name,
      nodeLabel,
      thread?.id ?? "default",
      format,
    );
    const body =
      format === "json"
        ? JSON.stringify(doc.json, null, 2)
        : doc.markdown;
    const mime = format === "json" ? "application/json" : "text/markdown;charset=utf-8";
    triggerDownload(new Blob([body], { type: mime }), filename);
  }

  stop(): void {
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId) return;
    this.runtime.stop(nodeId, this.graphService.activeThreadId(nodeId));
  }

  closeChat(): void {
    this.graphService.closeChatSidebar();
  }

  newThread(): void {
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId) return;
    this.graphService.createChatThread(nodeId);
  }

  selectThread(threadId: string): void {
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId || !threadId) return;
    this.graphService.selectChatThread(nodeId, threadId);
  }

  deleteThread(threadId: string, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId || !threadId) return;
    this.graphService.deleteChatThread(nodeId, threadId);
  }

  /** Drag вкладки/заголовка → drop на canvas создаёт ноду из треда. */
  onChatDragStart(event: DragEvent, threadId: string): void {
    const nodeId = this.graphService.selectedNodeId();
    if (!nodeId || !threadId || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const raw = serializeChatDragPayload({
      sourceNodeId: nodeId,
      threadId,
    });
    event.dataTransfer.setData(CHAT_DRAG_MIME, raw);
    event.dataTransfer.setData("text/plain", raw);
    event.dataTransfer.effectAllowed = "copy";
  }

  onHeaderDragStart(event: DragEvent): void {
    const threadId = this.activeThreadId();
    if (!threadId) {
      event.preventDefault();
      return;
    }
    this.onChatDragStart(event, threadId);
  }

  protected isStreamingMessage(msgId: string, last: boolean): boolean {
    return (
      last &&
      this.selectedChatRunning() &&
      !!this.messages().find((m) => m.id === msgId)?.content
    );
  }

  protected isPendingMessage(msgId: string, last: boolean): boolean {
    const msg = this.messages().find((m) => m.id === msgId);
    return (
      !!msg &&
      msg.role === "assistant" &&
      !msg.content &&
      !(msg.steps && msg.steps.length > 0) &&
      last &&
      this.selectedChatRunning()
    );
  }

  protected messageSteps(msg: { steps?: ChatRunStep[] }): ChatRunStep[] {
    return msg.steps ?? [];
  }

  protected priorSteps(steps: ChatRunStep[]): ChatRunStep[] {
    return steps.length > 1 ? steps.slice(0, -1) : [];
  }

  protected latestStep(steps: ChatRunStep[]): ChatRunStep | null {
    return steps.length ? steps[steps.length - 1]! : null;
  }

  protected stepPreview(step: ChatRunStep): string {
    return runStepPreview(step);
  }

  protected statsLabel(stats: ChatRunStats): string {
    return formatRunStatsLabel(stats);
  }

  protected statsBar(usage: ChatTokenUsage): RunStatsBarSegment[] {
    return runStatsBarSegments(usage);
  }

  protected stepBodyHtml(step: ChatRunStep): SafeHtml {
    if (step.kind === "tool") {
      const status = step.status === "running" ? "выполняется…" : "готово";
      return this.sanitizer.bypassSecurityTrustHtml(
        `<span class="chat-step-tool-name">${escapeHtml(step.label)}</span> · ${status}`,
      );
    }
    return this.sanitizer.bypassSecurityTrustHtml(
      renderChatMarkdown(this.chatBody(step.text) || "…"),
    );
  }

  private autosizePrompt(el: HTMLTextAreaElement): void {
    el.style.height = `${PROMPT_MIN_HEIGHT_PX}px`;
    const next = el.value.trim() === "" && !el.value.includes("\n")
      ? PROMPT_MIN_HEIGHT_PX
      : Math.min(Math.max(el.scrollHeight, PROMPT_MIN_HEIGHT_PX), PROMPT_MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }

  private resetPromptHeight(): void {
    const el = this.promptEl?.nativeElement;
    if (!el) return;
    el.style.height = `${PROMPT_MIN_HEIGHT_PX}px`;
  }

  private scrollToBottom(): void {
    const el = this.messagesEl?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
}
