import { tool } from "@anthropic-ai/claude-agent-sdk";
import { faultIndicatorQueryShape, lookupFaultIndicator } from "../fault-indicators";

export const lookupFaultIndicatorTool = tool(
  "lookup_fault_indicator",
  "Look up exact display text, a documented warning description, or a purported error code. An unknown code returns unknown_indicator and neutral safe actions; never infer a condition-specific fix from a similar-looking code.",
  faultIndicatorQueryShape,
  async (args) => {
    const result = lookupFaultIndicator(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
