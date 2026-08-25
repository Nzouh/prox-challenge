import { tool } from "@anthropic-ai/claude-agent-sdk";
import { checkRepairScope, repairScopeQueryShape } from "../repair-scope";

export const checkRepairScopeTool = tool(
  "check_repair_scope",
  "Classify a proposed maintenance or repair action as operator-permitted, deenergized-inspection-only, qualified-technician-required, explicitly prohibited, or not documented. Use this before DIY/internal repair advice. Never turn missing classification into permission.",
  repairScopeQueryShape,
  async (args) => {
    const result = checkRepairScope(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
