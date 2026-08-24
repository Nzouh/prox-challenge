import { z } from "zod";

/**
 * One turn can originate from four places (PLAN.md section 3): typed text, an uploaded
 * image, a hotspot click on the product photo, or an interaction with a rendered artifact.
 * All four normalize into this union before reaching the agent. Day 1 wires only the first.
 */
export const agentInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(4_000) }),
]);
export type AgentInput = z.infer<typeof agentInputSchema>;

export const chatRequestSchema = z.object({
  input: agentInputSchema,
  // JSON has no undefined, so any client that holds session id in nullable state sends
  // null on the first turn. Accept both and normalise to undefined at the boundary.
  sessionId: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
