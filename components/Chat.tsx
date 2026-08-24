"use client";

import { useState } from "react";
import type { AgentEvent, AgentUsage } from "@/lib/agent/events";
import type { Artifact } from "@/lib/agent/artifacts";
import { decodeSSE } from "@/lib/sse";
import { ArtifactView } from "./artifacts";

const SUGGESTED = "What's the duty cycle for MIG welding at 200A on 240V?";

type ToolCall = { id: string; name: string; ok?: boolean };

export function Chat() {
  const [draft, setDraft] = useState(SUGGESTED);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [tools, setTools] = useState<ToolCall[]>([]);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [usage, setUsage] = useState<{ usage: AgentUsage; costUsd: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  async function ask(text: string) {
    setQuestion(text);
    setAnswer("");
    setTools([]);
    setArtifact(null);
    setUsage(null);
    setError(null);
    setStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { kind: "text", text },
          ...(sessionId ? { sessionId } : {}),
        }),
      });

      if (!response.ok) {
        setError(`Request failed: ${response.status} ${await response.text()}`);
        return;
      }

      for await (const event of decodeSSE(response)) {
        apply(event);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
    }
  }

  function apply(event: AgentEvent) {
    switch (event.type) {
      case "session":
        setSessionId(event.sessionId);
        break;
      case "text_delta":
        setAnswer((prev) => prev + event.text);
        break;
      case "tool_start":
        setTools((prev) => [...prev, { id: event.id, name: event.name }]);
        break;
      case "tool_end":
        setTools((prev) =>
          prev.map((t) => (t.id === event.id ? { ...t, ok: event.ok } : t)),
        );
        break;
      case "artifact":
        setArtifact(event.artifact);
        break;
      case "done":
        setUsage({ usage: event.usage, costUsd: event.costUsd });
        break;
      case "error":
        setError(event.message);
        break;
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !streaming) void ask(draft.trim());
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about the machine..."
          disabled={streaming}
        />
        <button type="submit" disabled={streaming || !draft.trim()}>
          {streaming ? "Thinking" : "Ask"}
        </button>
      </form>

      <p className="hint">
        Try:{" "}
        <button type="button" onClick={() => setDraft(SUGGESTED)}>
          {SUGGESTED}
        </button>
      </p>

      {question && (
        <div className="turn">
          <p className="question">{question}</p>

          {tools.length > 0 && (
            <div className="trace">
              {tools.map((tool) => (
                <div key={tool.id} className={tool.ok ? "ok" : undefined}>
                  {tool.ok === undefined ? "→" : "✓"} {shortName(tool.name)}
                </div>
              ))}
            </div>
          )}

          {artifact && <ArtifactView artifact={artifact} />}

          {answer && (
            <div className="answer">
              {answer}
              {streaming && <span className="cursor">▍</span>}
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {usage && (
            <div className="usage">
              {usage.usage.inputTokens.toLocaleString()} in ·{" "}
              {usage.usage.outputTokens.toLocaleString()} out · cache read{" "}
              {usage.usage.cacheReadTokens.toLocaleString()} · ${usage.costUsd.toFixed(4)}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function shortName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "");
}
