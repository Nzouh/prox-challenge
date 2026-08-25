import { z } from "zod";
import { provenanceSchema } from "./provenance";
import { weldProcessSchema, inputVoltageSchema } from "./domain";

/**
 * The component schema. The agent picks a component and fills its params; we own the
 * rendering, so a malformed artifact cannot reach React — the schema below is what the
 * emit_artifact tool validates against.
 *
 * Day 5 adds the other five members from PLAN.md section 3: troubleshooting flow, settings
 * configurator, panel hotspot map, 3D geometry scene, cable routing.
 */
export const dutyCycleArtifactSchema = z.object({
  type: z.literal("duty_cycle"),
  process: weldProcessSchema,
  inputVoltage: inputVoltageSchema,
  amperage: z.number().positive().describe("Welding output current in amps."),
  dutyCyclePct: z
    .number()
    .positive()
    .max(100)
    .describe("Percent of the period the machine can weld."),
  periodMinutes: z
    .number()
    .positive()
    .describe("Length of the duty-cycle period, normally 10 minutes."),
  provenance: provenanceSchema,
});
export type DutyCycleArtifact = z.infer<typeof dutyCycleArtifactSchema>;

export const artifactSchema = z.discriminatedUnion("type", [dutyCycleArtifactSchema]);
export type Artifact = z.infer<typeof artifactSchema>;

const EXPLICIT_VISUAL_REQUEST =
  /\b(artifact|calculator|chart|diagram|draw|graph|interactive|plot|timeline|visual(?:i[sz](?:e|ation))?)\b/i;

/** Do not turn ordinary factual answers into unsolicited dashboard cards. */
export function shouldOfferArtifacts(question: string): boolean {
  return EXPLICIT_VISUAL_REQUEST.test(question);
}
