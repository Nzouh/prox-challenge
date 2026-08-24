import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "./events";

type TerminalEvent = Extract<AgentEvent, { type: "done" | "error" }>;

/** Convert the SDK's terminal result into exactly one UI terminal event. */
export function resultToEvent(message: SDKResultMessage): TerminalEvent {
  if (message.subtype !== "success") {
    const details = message.errors.filter(Boolean).join("; ");
    return {
      type: "error",
      message: details
        ? `Agent run ended (${message.subtype}): ${details}`
        : `Agent run ended: ${message.subtype}`,
    };
  }

  // The SDK can use subtype="success" for a completed request that still ended in an
  // API error. Never rewrite this flag; require it to be false before emitting `done`.
  if (message.is_error) {
    return {
      type: "error",
      message: message.result || "The model request failed without an error message.",
    };
  }

  return {
    type: "done",
    usage: {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    },
    costUsd: message.total_cost_usd,
  };
}
