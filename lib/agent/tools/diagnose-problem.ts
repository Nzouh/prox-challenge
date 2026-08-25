import { tool } from "@anthropic-ai/claude-agent-sdk";
import { diagnoseProblem, diagnosisQueryShape } from "../diagnosis";

export const diagnoseProblemTool = tool(
  "diagnose_problem",
  "Look up an observed symptom in the validated troubleshooting graph. Returns documented causes, ordered checks/remedies, shutdown prerequisites, and repair scope. Unknown or ambiguous symptoms never receive guessed fixes.",
  diagnosisQueryShape,
  async (args) => {
    const result = diagnoseProblem(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
