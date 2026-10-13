/** Ключ чата: нода + тред (для draft и параллельных ранов). */
export function chatScopeKey(nodeId: string, threadId: string | null | undefined): string {
  return `${nodeId}::${threadId ?? ''}`;
}
