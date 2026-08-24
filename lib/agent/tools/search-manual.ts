import { tool } from "@anthropic-ai/claude-agent-sdk";
import { manualSearchQueryShape, searchManual } from "../manual-search";

export const searchManualTool = tool(
  "search_manual",
  "Search all visually validated manual, guide, chart, and product-image Markdown. Use for open-ended safety, setup, maintenance, controls, and technique questions. A miss means the supplied sources do not answer the query.",
  manualSearchQueryShape,
  async (args) => {
    const result = searchManual(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
