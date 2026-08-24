import { tool } from "@anthropic-ai/claude-agent-sdk";
import { assessJobRisk, jobRiskQueryShape } from "../safety";

export const assessJobRiskTool = tool(
  "assess_job_risk",
  "Evaluate explicitly known welding or repair context against deterministic safety rules. Call this before advising on bypasses, DIY repair, hazardous/unknown materials, containers, confined or wet work, combustibles, incomplete PPE, or safety-critical structures. Never fill unstated fields with safe values.",
  jobRiskQueryShape,
  async (args) => {
    const result = assessJobRisk(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
