import { z } from "zod";
import { provenanceSchema } from "./provenance";
import { weldProcessSchema, inputVoltageSchema } from "./domain";

/**
 * The component schema. Every artifact is derived host-side from the evidence its tool
 * returned, so these types describe what the host may build and what React may render —
 * the model neither selects a component nor fills its params.
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
export const sourceVisualArtifactSchema = z.object({
  type: z.literal("source_visual"),
  imageUrl: z.string().startsWith("/api/source-assets?").max(500),
  page: z.number().int().positive().optional(),
  provenance: provenanceSchema,
  caption: z.string().trim().min(1).max(240),
});
export type SourceVisualArtifact = z.infer<typeof sourceVisualArtifactSchema>;

/** Mirrors setups.ts SetupStage (minus "all"); duplicated so this schema has no runtime
 *  dependency on setups.ts, which does synchronous knowledge-file reads at import time. */
const setupChecklistStageSchema = z.enum([
  "cables",
  "workpiece",
  "consumables",
  "power_controls",
  "shutdown",
]);
export const setupChecklistStepSchema = z.object({
  order: z.number().int().positive(),
  stage: setupChecklistStageSchema,
  state: z.enum(["required", "optional", "disconnected", "conditional"]),
  label: z.string().trim().min(1).max(80).optional(),
  condition: z.string().trim().min(1).max(200).optional(),
  instruction: z.string().trim().min(1).max(400),
});
export type SetupChecklistStep = z.infer<typeof setupChecklistStepSchema>;

export const setupChecklistArtifactSchema = z.object({
  type: z.literal("setup_checklist"),
  process: weldProcessSchema,
  stage: setupChecklistStageSchema.or(z.literal("all")),
  prerequisites: z.array(z.string().trim().min(1)).max(20),
  steps: z.array(setupChecklistStepSchema).min(2).max(40),
  provenance: z.array(provenanceSchema).min(1).max(20),
});
export type SetupChecklistArtifact = z.infer<typeof setupChecklistArtifactSchema>;

/** Where one validated cable lead terminates. Derived host-side from the reviewed
 *  get_setup instruction text by an exact-match table (lib/agent/polarity-map.ts); the
 *  model never supplies or edits an endpoint. */
export const cableEndpointSchema = z.enum([
  "positive_terminal",
  "negative_terminal",
  "wire_feed",
  "gas_regulator",
  "internal_connection",
  "unconnected",
]);
export type CableEndpoint = z.infer<typeof cableEndpointSchema>;

export const cableTerminalSchema = z.enum(["positive", "negative"]);
export type CableTerminal = z.infer<typeof cableTerminalSchema>;

export const cableConnectionSchema = z.object({
  order: z.number().int().positive(),
  component: z.string().trim().min(1).max(60),
  /** Which side of the circuit the lead is: the electrode lead, the work (ground) lead,
   *  or an auxiliary line that carries no welding current. */
  role: z.enum(["electrode", "work", "auxiliary"]),
  endpoint: cableEndpointSchema,
  state: z.enum(["required", "optional", "disconnected"]),
  instruction: z.string().trim().min(1).max(400),
  provenance: provenanceSchema,
});
export type CableConnection = z.infer<typeof cableConnectionSchema>;

export const polarityMapArtifactSchema = z.object({
  type: z.literal("polarity_map"),
  process: weldProcessSchema,
  /** Null whenever the validated data does not put the electrode and work leads on
   *  opposite terminals — the map still renders, it just carries no polarity name. */
  polarity: z
    .object({
      label: z.enum(["DCEP", "DCEN"]),
      electrodeTerminal: cableTerminalSchema,
      workTerminal: cableTerminalSchema,
      /** Tier 3: the terminals are tier-1 manual facts, the DCEP/DCEN name is the
       *  definition applied to them. The two must never be shown as one voice. */
      provenance: provenanceSchema,
    })
    .nullable(),
  prerequisites: z.array(z.string().trim().min(1)).max(20),
  connections: z.array(cableConnectionSchema).min(2).max(12),
  provenance: z.array(provenanceSchema).min(1).max(20),
});
export type PolarityMapArtifact = z.infer<typeof polarityMapArtifactSchema>;

export const repairScopeArtifactSchema = z.enum([
  "operator_permitted",
  "qualified_technician_required",
]);

export const troubleshootingBranchSchema = z.object({
  /** Matches the node key in the Mermaid source, so a click on the diagram resolves back
   *  to the branch it came from. */
  key: z.string().regex(/^c[0-9]+$/),
  id: z.string().trim().min(1).max(120),
  /** Intentionally short: this is the only branch text visible before expansion, and it
   *  is the graph's own cause wording rather than a summary of it. */
  cause: z.string().trim().min(1).max(240),
  check: z.string().trim().min(1).max(400),
  remedy: z.string().trim().min(1).max(500),
  /** Exact values or connection facts resolved host-side from structured lookup tools.
   *  These replace vague remedy prose in the expansion when available. */
  specifics: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
        provenance: provenanceSchema,
      }),
    )
    .max(6)
    .optional(),
  /** If structured lookups cannot make a vague instruction more specific, show the
   * reviewed source rather than asking the model to guess. */
  supportingVisual: sourceVisualArtifactSchema.optional(),
  repairScope: repairScopeArtifactSchema,
});
export type TroubleshootingBranch = z.infer<typeof troubleshootingBranchSchema>;

/** A bounded, grounded decision path. The host derives it from diagnose_problem and
 *  serialises the Mermaid source itself; the model never supplies branch text, edges, or
 *  diagram syntax. */
export const troubleshootingFlowArtifactSchema = z.object({
  type: z.literal("troubleshooting_flow"),
  recordId: z.string().trim().min(1).max(100),
  problem: z.string().trim().min(1).max(240),
  processes: z.array(weldProcessSchema).min(1).max(4),
  /** Present only when the documented prerequisite is an actionable instruction; the
   *  generic "follow all safety precautions" boilerplate earns no callout. */
  stopCondition: z.string().trim().min(1).max(500).optional(),
  /** Cumulative Mermaid sources: stage 1 contains the first check, and every later stage
   * appends one node without removing previously revealed checks. */
  mermaidStages: z.array(z.string().trim().min(1).max(8000)).min(2).max(13),
  branches: z.array(troubleshootingBranchSchema).min(1).max(12),
  provenance: z.array(provenanceSchema).min(1).max(20),
});
export type TroubleshootingFlowArtifact = z.infer<typeof troubleshootingFlowArtifactSchema>;

export const artifactSchema = z.discriminatedUnion("type", [
  dutyCycleArtifactSchema,
  sourceVisualArtifactSchema,
  setupChecklistArtifactSchema,
  polarityMapArtifactSchema,
  troubleshootingFlowArtifactSchema,
]);
export type Artifact = z.infer<typeof artifactSchema>;

export type DiagramNeed = "none" | "flowchart" | "sequence";

/**
 * Presentation-only heuristic. It does not decide whether a manual lookup is
 * needed; it only identifies procedures where relationships or ordering are
 * materially clearer as a diagram.
 */
export function diagramNeed(question: string): DiagramNeed {
  const text = question.trim();
  if (!text) return "none";
  if (/\b(?:sequence\s+diagram|sequence)\b/i.test(text)) return "sequence";
  if (/\b(?:flowchart|flow\s*chart|decision\s+tree)\b/i.test(text)) return "flowchart";

  const orderedProcedure =
    /\b(?:complete|full|step[- ]by[- ]step|walk(?: me)? through|how do i|startup|start[- ]up|shutdown|troubleshoot|diagnos(?:e|is))\b/i.test(text);
  const hasMultipleStages =
    (text.match(/\b(?:then|next|after|before|until|if|otherwise|first|second|third|finally)\b/gi) ?? [])
      .length >= 2;
  if (orderedProcedure && hasMultipleStages) return "flowchart";
  return "none";
}
