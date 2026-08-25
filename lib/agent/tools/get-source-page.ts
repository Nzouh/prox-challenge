import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getSourcePage, sourcePageQueryShape } from "../source-page";

export const getSourcePageTool = tool(
  "get_source_page",
  "Return the exact reviewed PDF page or product-image render from the validated knowledge manifest. Use this when the source image itself is authoritative or the user asks to see the manual page; do not redraw a schematic from memory.",
  sourcePageQueryShape,
  async (args) => {
    const result = getSourcePage(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
