import { tool } from "@anthropic-ai/claude-agent-sdk";
import { resolveSpecQuery, specQueryShape, specQuerySchema } from "../specs";

export { specQueryShape, specQuerySchema };

export const lookupSpec = tool(
  "lookup_spec",
  "Look up a published specification for the Vulcan OmniPro 220 from visually validated generated facts. Supports duty cycle, current range, OCV, wire speed, spool capacity, and polarity. Never answer a spec question from memory.",
  specQueryShape,
  async (args) => {
    const result = resolveSpecQuery(args);

    return {
      // structuredContent is what Claude reads. The text block remains a readable trace.
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
