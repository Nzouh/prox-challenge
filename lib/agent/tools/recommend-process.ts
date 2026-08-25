import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  processRecommendationQueryShape,
  recommendProcess,
} from "../process-recommendation";

export const recommendProcessTool = tool(
  "recommend_process",
  "Recommend Flux-cored, MIG, Stick, or TIG by traversing the visually validated selection chart. Use for any question asking which welding process to choose or compare for skill, gas, environment, material, thickness, application, or weld cleanliness. Missing or incompatible constraints return explicit non-guessed results.",
  processRecommendationQueryShape,
  async (args) => {
    const result = recommendProcess(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
