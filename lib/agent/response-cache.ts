import type { AgentEvent } from "./events";

export type CachedResponseEvent = Extract<AgentEvent, { type: "artifact" | "text_delta" }>;

type CacheEntry = {
  expiresAt: number;
  events: CachedResponseEvent[];
};

/** Small process-local LRU cache. Only callers holding a fully verified response may write. */
export class VerifiedResponseCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries = 64,
    private readonly ttlMs = 30 * 60 * 1_000,
  ) {}

  get(key: string, now = Date.now()): CachedResponseEvent[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return [...entry.events];
  }

  set(key: string, events: readonly CachedResponseEvent[], now = Date.now()): void {
    if (!events.some((event) => event.type === "text_delta" && event.text.trim().length > 0)) return;
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: now + this.ttlMs, events: [...events] });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function responseCacheKey(question: string, knowledgeRevision: string): string {
  const normalized = question.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return `${knowledgeRevision}:${normalized}`;
}
