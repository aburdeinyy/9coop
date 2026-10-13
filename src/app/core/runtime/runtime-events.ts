import type {
  ArtifactKind,
  ChatMessage,
  ChatRunStats,
  LayercoopGraph,
} from '../models/graph.model';
import type { BridgeSseEvent } from './llm-provider';

export type RuntimeEvent =
  | { type: 'run:start'; runId: string }
  /** Артефакты, попавшие в system prompt текущего рана — горят до run:end. */
  | { type: 'run:context'; nodeIds: string[]; edgeIds: string[] }
  | { type: 'node:active'; nodeId: string }
  | { type: 'node:done'; nodeId: string }
  | { type: 'edge:flow'; edgeId: string }
  | {
      type: 'tool:call';
      nodeId: string;
      name: string;
      status: 'start' | 'end';
      callId?: string;
      detail?: string;
    }
  /** toChat: false — только в шаги (стрим саб-GOD), не в текст ответа. */
  | { type: 'token'; text: string; toChat?: boolean }
  /** Usage/duration от bridge (Cursor) — может прийти несколько раз при делегировании. */
  | { type: 'run:stats'; stats: ChatRunStats }
  | { type: 'run:cancelled'; runId: string }
  | { type: 'run:end'; runId: string };

export interface RuntimePlanStep {
  nodeId: string;
  kind: 'god' | ArtifactKind;
  edgeId?: string;
}

export type RuntimeStreamFn = (
  graph: LayercoopGraph,
  userPrompt: string,
  opts: {
    focusNodeId: string;
    chatHistory: ChatMessage[];
    executorNodeId?: string;
    signal?: AbortSignal;
    forceArtifactIds?: string[];
  },
) => AsyncGenerator<BridgeSseEvent>;

export interface RuntimeOptions {
  runId?: string;
  delay?: (ms: number) => Promise<void>;
  stepMs?: number;
  tokenMs?: number;
  focusNodeId?: string;
  chatHistory?: ChatMessage[];
  /** Пайпы / явный include вне connected-пула. */
  forceArtifactIds?: string[];
  /** Отмена текущего рана (кнопка Стоп). */
  signal?: AbortSignal;
  complete?: (
    graph: LayercoopGraph,
    userPrompt: string,
    opts: {
      focusNodeId: string;
      chatHistory: ChatMessage[];
      executorNodeId?: string;
      forceArtifactIds?: string[];
    },
  ) => Promise<string>;
  /** Тесты / подмена streamRunner; при наличии complete не используется. */
  stream?: RuntimeStreamFn;
}
