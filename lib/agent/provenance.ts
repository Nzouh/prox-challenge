import { z } from "zod";

/**
 * Every claim the agent makes carries one of three tiers, and the UI renders them
 * visually distinctly. See CLAUDE.md invariants and PLAN.md section 4.
 *
 *   1 — the manual (or the placard photos), cited to page/figure
 *   2 — allowlisted web, cited to URL, explicitly non-manual
 *   3 — inference from tier-1 specs or general welding engineering
 *
 * Day 1 only ever constructs tier 1. Tiers 2 and 3 exist in the type so that adding
 * them later is a compile error at every site that has to handle them, not a silent
 * blur of the distinction.
 */
export const provenanceSchema = z.discriminatedUnion("tier", [
  z.object({
    tier: z.literal(1),
    source: z.string().min(1),
    page: z.number().int().positive().optional(),
    figure: z.string().min(1).optional(),
    sourceHash: z.string().length(64).optional(),
  }),
  z.object({
    tier: z.literal(2),
    source: z.string().min(1),
    url: z.string().url(),
  }),
  z.object({
    tier: z.literal(3),
    source: z.string().min(1),
    basis: z.string().min(1),
  }),
]);

export type Provenance = z.infer<typeof provenanceSchema>;
export type ProvenanceTier = Provenance["tier"];
