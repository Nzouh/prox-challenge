import { tool } from "@anthropic-ai/claude-agent-sdk";
import { assessPowerSource, powerSourceQueryShape } from "../power-source";

export const assessPowerSourceTool = tool(
  "assess_power_source",
  "Check a proposed power source against the validated OmniPro 220 input requirements. Voltage alone is never sufficient: verify grounding, GFCI, delayed-action protection, matching plug, cord, frequency, and extension-cord use. Treat generators, inverters, batteries, EVs, and unknown sources as unsupported unless separately approved; never infer safety.",
  powerSourceQueryShape,
  async (args) => {
    const result = assessPowerSource(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
