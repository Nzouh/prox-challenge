import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getSetup, setupQueryShape } from "../setups";

export const getSetupTool = tool(
  "get_setup",
  "Return visually validated setup steps for MIG, self-shielded flux-cored, TIG, or Stick. The process may be omitted when unknown; the tool returns structured insufficient_information so you can ask one clarification. Select cables, workpiece, consumables, power_controls, shutdown, or all. Results preserve required, optional, conditional, and deliberately disconnected states. Use this instead of assembling setup instructions from memory.",
  setupQueryShape,
  async (args) => {
    const result = getSetup(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
