import type { Conversation, Turn } from "./conversation";

/**
 * Browser-side persistence for the conversation list.
 *
 * Transcripts live in localStorage rather than a cookie: one answer plus its artifacts
 * already exceeds the ~4KB a cookie carries, and the server has no use for the transcript
 * on the request path. Nothing written here is ever sent anywhere.
 */

const STORAGE_KEY = "arc.conversations.v1";

/** Enough history to be useful, bounded so the origin quota is never the failure mode. */
const MAX_CONVERSATIONS = 40;

type StoredShape = { version: 1; conversations: Conversation[] };

/**
 * A status and stage describe a request that is in flight right now. Restoring them would
 * park a dead spinner above a finished answer, so they are dropped on the way out.
 */
function settle(turn: Turn): Turn {
  return { ...turn, status: null, stage: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Structural check rather than a cast. The blob is user-writable and can predate this
 * build, so a malformed entry loses its own row and never the whole list.
 */
function reviveConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  const { id, createdAt, title, sessionId, turns } = value;
  if (typeof id !== "string" || typeof createdAt !== "number" || !Array.isArray(turns)) return null;

  const revived = turns.filter(isRecord).flatMap<Turn>((turn) => {
    if (typeof turn.id !== "string" || typeof turn.question !== "string") return [];
    return [
      {
        id: turn.id,
        question: turn.question,
        answer: typeof turn.answer === "string" ? turn.answer : "",
        status: null,
        stage: null,
        tools: Array.isArray(turn.tools) ? (turn.tools as Turn["tools"]) : [],
        artifacts: Array.isArray(turn.artifacts) ? (turn.artifacts as Turn["artifacts"]) : [],
        usage: isRecord(turn.usage) ? (turn.usage as Turn["usage"]) : null,
        error: typeof turn.error === "string" ? turn.error : null,
      },
    ];
  });

  if (revived.length === 0) return null;
  return {
    id,
    createdAt,
    title: typeof title === "string" ? title : null,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    turns: revived,
  };
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // A private window or blocked site data throws on the accessor itself, not on read.
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.conversations)) return [];
    return parsed.conversations
      .map(reviveConversation)
      .filter((conversation): conversation is Conversation => conversation !== null)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;

  // A conversation with no turns is the empty one the composer is sitting on. It has
  // nothing to restore and would come back as a blank sidebar row.
  const keep = conversations
    .filter((conversation) => conversation.turns.length > 0)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({ ...conversation, turns: conversation.turns.map(settle) }));

  // Shed oldest-first when the quota is hit: artifacts make a single thread large enough
  // that one outsized conversation should not cost the user every other one.
  for (let limit = keep.length; limit >= 0; limit -= 1) {
    const payload: StoredShape = { version: 1, conversations: keep.slice(0, limit) };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return;
    } catch {
      if (limit === 0) return;
    }
  }
}
