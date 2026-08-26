"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";
import { InteractiveView } from "./manual/InteractiveView";
import { Sidebar } from "./Sidebar";
import { decodeSSE } from "@/lib/sse";
import type { AgentEvent } from "@/lib/agent/events";
import { withBasePath } from "@/lib/base-path";
import { loadConversations, saveConversations } from "@/lib/conversation-store";
import {
  newConversation,
  titleFrom,
  type Conversation,
  type Turn,
} from "@/lib/conversation";

/**
 * Owns everything that has to outlive a view switch: the conversation list, the active
 * session, and the in-flight request. The explorer replaces the chat view rather than
 * sitting beside it, so Chat unmounts when you open it — a stream driven from inside
 * Chat would be cancelled by looking at the machine.
 */

type View = "chat" | "explorer";

const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`;

export function AppShell() {
  const [view, setView] = useState<View>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // Restored on mount rather than in a state initializer: localStorage does not exist
  // during the server render, so seeding from it would hydrate against a different tree.
  useEffect(() => {
    setConversations(loadConversations());
    setHydrated(true);
  }, []);

  // Held until that restore has run, so the first render's empty list cannot overwrite
  // stored history. Writes are also skipped mid-stream — saving on every token would
  // serialise the whole transcript per delta, and the turn lands when the stream ends.
  useEffect(() => {
    if (!hydrated || streaming) return;
    saveConversations(conversations);
  }, [hydrated, streaming, conversations]);

  const patch = useCallback((id: string, map: (conversation: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? map(c) : c)));
  }, []);

  const patchTurn = useCallback(
    (conversationId: string, turnId: string, map: (turn: Turn) => Turn) => {
      patch(conversationId, (conversation) => ({
        ...conversation,
        turns: conversation.turns.map((turn) => (turn.id === turnId ? map(turn) : turn)),
      }));
    },
    [patch],
  );

  const apply = useCallback(
    (conversationId: string, turnId: string, event: AgentEvent) => {
      switch (event.type) {
        case "session":
          patch(conversationId, (c) => ({ ...c, sessionId: event.sessionId }));
          break;
        case "status":
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            status: event.message,
            stage: event.stage,
          }));
          break;
        case "text_delta":
          patchTurn(conversationId, turnId, (t) => ({ ...t, answer: t.answer + event.text }));
          break;
        case "tool_start":
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            tools: [...t.tools, { id: event.id, name: event.name }],
          }));
          break;
        case "tool_end":
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            tools: t.tools.map((tool) => (tool.id === event.id ? { ...tool, ok: event.ok } : tool)),
          }));
          break;
        case "evidence":
          // Evidence summaries are streamed for evaluation and observability. The user
          // interface continues to render the grounded answer and artifacts themselves.
          break;
        case "artifact":
          patchTurn(conversationId, turnId, (t) => ({ ...t, artifacts: [...t.artifacts, event.artifact] }));
          break;
        case "done":
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            status: null,
            stage: null,
            usage: { usage: event.usage, costUsd: event.costUsd, cached: event.cached },
          }));
          break;
        case "error":
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            status: null,
            stage: null,
            error: event.message,
          }));
          break;
      }
    },
    [patch, patchTurn],
  );

  const ask = useCallback(
    async (text: string) => {
      // A question with no conversation open starts one, so the sidebar never shows an
      // empty row waiting to be filled.
      const existing = conversations.find((c) => c.id === activeId) ?? null;
      const conversation = existing ?? newConversation(uid());
      const conversationId = conversation.id;
      const sessionId = conversation.sessionId;
      const turnId = uid();

      const turn: Turn = {
        id: turnId,
        question: text,
        answer: "",
        status: "Starting response…",
        stage: null,
        tools: [],
        artifacts: [],
        usage: null,
        error: null,
      };

      const withTurn = (c: Conversation): Conversation => ({
        ...c,
        title: c.title ?? titleFrom(text),
        turns: [...c.turns, turn],
      });

      setConversations((prev) =>
        existing ? prev.map((c) => (c.id === conversationId ? withTurn(c) : c)) : [withTurn(conversation), ...prev],
      );
      setActiveId(conversationId);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(withBasePath("/api/chat"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            input: { kind: "text", text },
            ...(sessionId ? { sessionId } : {}),
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            status: null,
            stage: null,
            error: `Request failed: ${response.status} ${body}`,
          }));
          return;
        }

        for await (const event of decodeSSE(response)) {
          apply(conversationId, turnId, event);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          patchTurn(conversationId, turnId, (t) => ({ ...t, status: "Cancelled.", stage: null }));
        } else {
          patchTurn(conversationId, turnId, (t) => ({
            ...t,
            status: null,
            stage: null,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      } finally {
        patchTurn(conversationId, turnId, (t) =>
          t.status === "Cancelled." ? t : { ...t, status: null, stage: null },
        );
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [activeId, conversations, apply, patchTurn],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setQuery("");
    setView("chat");
  }, []);

  const select = useCallback((id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    setView("chat");
  }, []);

  // The explorer is a full-screen view, so Escape has to get you back out of it. Inside
  // the explorer, Escape first resets the camera; this only fires once nothing is zoomed.
  useEffect(() => {
    if (view !== "explorer") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".stage.is-zoomed")) {
        setView("chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  if (view === "explorer") {
    return <InteractiveView onBack={() => setView("chat")} />;
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        query={query}
        onQuery={setQuery}
        onSelect={select}
        onNew={startNew}
      />
      <Chat
        conversation={active}
        streaming={streaming}
        onAsk={ask}
        onCancel={cancel}
        onOpenExplorer={() => setView("explorer")}
      />
    </div>
  );
}
