export type PendingInteractionSource = "protocol" | "rollout";

export interface PendingInteractionRef {
  id: string;
  threadId?: string;
  turnId?: string;
}

export class PendingInteractionTracker {
  private readonly entries = new Map<PendingInteractionSource, Map<string, PendingInteractionRef>>([
    ["protocol", new Map()],
    ["rollout", new Map()]
  ]);
  private hostVisible = false;

  add(source: PendingInteractionSource, ref: PendingInteractionRef) {
    const entries = this.entries.get(source)!;
    const previous = entries.get(ref.id);
    entries.set(ref.id, ref);
    return JSON.stringify(previous) !== JSON.stringify(ref);
  }

  resolve(source: PendingInteractionSource, id: string) {
    const entries = this.entries.get(source)!;
    const resolved = entries.get(id);
    if (resolved) entries.delete(id);
    return resolved;
  }

  replace(source: PendingInteractionSource, refs: PendingInteractionRef[]) {
    const entries = this.entries.get(source)!;
    const previous = JSON.stringify([...entries.values()]);
    entries.clear();
    for (const ref of refs) entries.set(ref.id, ref);
    return previous !== JSON.stringify([...entries.values()]);
  }

  clearTurn(threadId: string, turnId?: string) {
    return this.removeWhere((ref) => ref.threadId === threadId && (!turnId || ref.turnId === turnId));
  }

  clearThread(threadId: string) {
    return this.removeWhere((ref) => ref.threadId === threadId);
  }

  setHostVisible(visible: boolean) {
    if (this.hostVisible === visible) return false;
    this.hostVisible = visible;
    return true;
  }

  hasWaiting() {
    return this.hostVisible || [...this.entries.values()].some((entries) => entries.size > 0);
  }

  hasForThread(threadId: string) {
    return [...this.entries.values()].some((entries) => [...entries.values()].some((ref) => ref.threadId === threadId));
  }

  reset() {
    for (const entries of this.entries.values()) entries.clear();
    this.hostVisible = false;
  }

  private removeWhere(predicate: (ref: PendingInteractionRef) => boolean) {
    let changed = false;
    for (const entries of this.entries.values()) {
      for (const [id, ref] of entries) if (predicate(ref)) changed = entries.delete(id) || changed;
    }
    return changed;
  }
}
