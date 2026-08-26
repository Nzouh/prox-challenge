import { tool } from "@anthropic-ai/claude-agent-sdk";
import { agentEmittableArtifactSchema } from "../artifacts";

export const emitArtifact = tool(
  "emit_artifact",
  "Render a grounded duty_cycle calculator when the user requests one. Never use it for an ordinary single-value answer. Do not call this for source images, setup checklists, polarity maps, or troubleshooting flows: their evidence tools render them automatically. Copy duty-cycle provenance from lookup_spec unchanged.",
  { artifact: agentEmittableArtifactSchema.describe("The duty-cycle artifact to render.") },
  async (args) => {
    // The handler does not deliver the artifact. lib/agent/run.ts watches the assistant
    // message stream for this tool_use block, validates its input, and forwards it to the
    // browser as an `artifact` event — so the artifact reaches the UI whether or not the
    // model ever reads this result.
    return {
      content: [
        {
          type: "text" as const,
          text: `Rendered the ${args.artifact.type} artifact. It is now on screen; do not repeat its contents as a table.`,
        },
      ],
    };
  },
  { annotations: { readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
);
