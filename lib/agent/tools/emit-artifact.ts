import { tool } from "@anthropic-ai/claude-agent-sdk";
import { artifactSchema } from "../artifacts";

export const emitArtifact = tool(
  "emit_artifact",
  "Render an interactive artifact only when the user explicitly asks for a visual, chart, diagram, or calculator. Never use it for an ordinary single-value specification answer. Copy provenance from the lookup result unchanged.",
  { artifact: artifactSchema.describe("The artifact to render.") },
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
