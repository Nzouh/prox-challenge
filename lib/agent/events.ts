import type { Artifact } from "./artifacts";

/**
 * The wire contract between the route and the browser. One JSON-encoded AgentEvent per
 * SSE frame. Adding a member is safe for the producer and deliberately breaks exhaustive
 * switches in the consumer.
 *
 * Day 3 adds a `plan` event for the explicit plan_response step (PLAN.md section 3).
 */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; ok: boolean }
  | { type: "artifact"; artifact: Artifact }
  | { type: "done"; usage: AgentUsage; costUsd: number }
  | { type: "error"; message: string };

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  /**
   * The cache canary from PLAN.md section 3. Zero across turns once the corpus lands in
   * the frozen prefix means something is invalidating it and we are paying ~10x.
   * Surfaced in the UI from day 1 so the regression is visible the moment it happens.
   */
  cacheReadTokens: number;
};
