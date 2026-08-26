import type { Artifact } from "@/lib/agent/artifacts";
import type { AgentStage, AgentUsage } from "@/lib/agent/events";

/**
 * Client-side conversation model. The server keeps the real Agent SDK session; this is
 * only what the sidebar and the transcript need to render. It is deliberately in-memory:
 * a session id that outlived a server restart would point at nothing, so persisting the
 * list would promise continuity the backend cannot honour.
 */

export type ToolCall = { id: string; name: string; ok?: boolean };

export type Turn = {
  id: string;
  question: string;
  answer: string;
  status: string | null;
  stage: AgentStage | null;
  tools: ToolCall[];
  artifacts: Artifact[];
  usage: { usage: AgentUsage; costUsd: number; cached?: boolean } | null;
  error: string | null;
};

export type Conversation = {
  id: string;
  createdAt: number;
  /** Null until the first question lands, which is what names it. */
  title: string | null;
  /** The Agent SDK session this conversation resumes. */
  sessionId: string | null;
  turns: Turn[];
};

export type ConversationGroup = { label: string; items: Conversation[] };

const DAY_MS = 86_400_000;

export function newConversation(id: string, now = Date.now()): Conversation {
  return { id, createdAt: now, title: null, sessionId: null, turns: [] };
}

/** First question, trimmed to something that fits the sidebar without a tooltip. */
export function titleFrom(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  return flat.length > 52 ? `${flat.slice(0, 51)}…` : flat;
}

/** Buckets by calendar day rather than elapsed hours, so a conversation from 11pm
 *  reads as "Yesterday" the next morning instead of "Today". */
export function groupConversations(
  conversations: Conversation[],
  now = Date.now(),
): ConversationGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const buckets: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const conversation of [...conversations].sort((a, b) => b.createdAt - a.createdAt)) {
    if (conversation.createdAt >= startOfToday) buckets[0].items.push(conversation);
    else if (conversation.createdAt >= startOfToday - DAY_MS) buckets[1].items.push(conversation);
    else if (conversation.createdAt >= startOfToday - 7 * DAY_MS) buckets[2].items.push(conversation);
    else buckets[3].items.push(conversation);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}

const STAGE_LABEL: Record<AgentStage, string> = {
  cache: "Checking validated answers",
  research: "Checking the manual",
  verification: "Verifying safety",
  writing: "Writing the answer",
};

/** The real orchestration stage, never a generic "Thinking". */
export function stageLabel(stage: AgentStage | null): string {
  return stage ? STAGE_LABEL[stage] : "Working";
}
