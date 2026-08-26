import type { Artifact } from "./artifacts";

export type AgentEvidenceValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

/**
 * Public, normalized evidence metadata. This intentionally omits raw tool payloads so
 * evaluators can assert meaning without coupling themselves to prose or exposing the
 * complete internal research transcript to the browser.
 */
export type AgentEvidenceSummary = {
  tool: string;
  found?: boolean;
  status?: string;
  recordId?: string;
  spec?: string;
  value?: AgentEvidenceValue;
  unit?: string;
  process?: string;
};

/**
 * The wire contract between the route and the browser. One JSON-encoded AgentEvent per
 * SSE frame. Adding a member is safe for the producer and deliberately breaks exhaustive
 * switches in the consumer.
 *
 * Day 3 adds a `plan` event for the explicit plan_response step (PLAN.md section 3).
 */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; stage: AgentStage; message: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; ok: boolean }
  | { type: "evidence"; evidence: AgentEvidenceSummary }
  | { type: "artifact"; artifact: Artifact }
  | { type: "done"; usage: AgentUsage; costUsd: number; cached?: boolean }
  | { type: "error"; message: string };

export type AgentStage = "cache" | "research" | "verification" | "writing";

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
