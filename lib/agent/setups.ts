import { z } from "zod";
import type { SetupChecklistArtifact, SetupChecklistStep } from "./artifacts";
import { weldProcessSchema } from "./domain";
import { provenanceFor, readKnowledgeJson } from "./knowledge";

const sourceSchema = z.object({
  file: z.string().min(1),
  page: z.number().int().positive(),
});

const setupStepSchema = z.object({
  order: z.number().int().positive(),
  component: z.string().min(1),
  state: z.enum(["required", "optional", "disconnected"]),
  instruction: z.string().min(1),
});

const setupRecordSchema = z.object({
  id: z.string().min(1),
  process: weldProcessSchema,
  prerequisites: z.array(z.string().min(1)).min(1),
  steps: z.array(setupStepSchema).min(1),
  source: sourceSchema,
  safety_source: sourceSchema,
});

const setupRecords = z
  .array(setupRecordSchema)
  .length(4)
  .parse(readKnowledgeJson("setups/cable-setups.json"));

export const setupStageSchema = z.enum([
  "cables",
  "workpiece",
  "consumables",
  "power_controls",
  "shutdown",
  "all",
]);
export type SetupStage = z.infer<typeof setupStageSchema>;

const operatingSetupRecordSchema = z.object({
  id: z.string().min(1),
  processes: z.array(weldProcessSchema).min(1),
  stage: setupStageSchema.exclude(["cables", "all"]),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        state: z.enum(["required", "optional", "conditional"]),
        condition: z.string().min(1).optional(),
        instruction: z.string().min(1),
      }),
    )
    .min(1),
  source: sourceSchema,
});

const operatingSetupRecords = z
  .array(operatingSetupRecordSchema)
  .min(1)
  .parse(readKnowledgeJson("setups/operating-setups.json"));

export const setupQueryShape = {
  process: weldProcessSchema.optional().describe("Welding process when known: MIG, flux_cored, TIG, or stick."),
  stage: setupStageSchema
    .optional()
    .default("all")
    .describe("Setup stage to return; use all only when the user requests the complete setup."),
};
export const setupQuerySchema = z.object(setupQueryShape);
export type SetupQuery = z.input<typeof setupQuerySchema>;

/** Deterministic process setup from the visually reviewed quick-start cable diagrams. */
export function getSetup(unparsed: SetupQuery) {
  const query = setupQuerySchema.parse(unparsed);
  if (!query.process) {
    return {
      found: false as const,
      status: "insufficient_information" as const,
      requiredFields: ["process"] as const,
      allowedProcesses: ["MIG", "flux_cored", "TIG", "stick"] as const,
      note: "Choose a welding process before returning process-specific setup steps.",
    };
  }
  const process = query.process;
  const record = setupRecords.find((item) => item.process === process);
  if (!record) {
    return {
      found: false as const,
      status: "not_documented" as const,
      process,
      note: "No visually validated setup record exists for that process.",
    };
  }
  const cableSteps = record.steps.map((step) => ({
    ...step,
    stage: "cables" as const,
    recordId: record.id,
    provenance: provenanceFor(record.source),
  }));
  const operatingSteps = operatingSetupRecords
    .filter(
      (item) =>
        item.processes.includes(process) &&
        (query.stage === "all" || item.stage === query.stage),
    )
    .flatMap((item) =>
      item.steps.map((step) => ({
        ...step,
        stage: item.stage,
        recordId: item.id,
        provenance: provenanceFor(item.source),
      })),
    );
  const stageOrder: Record<Exclude<SetupStage, "all">, number> = {
    cables: 0,
    workpiece: 1,
    consumables: 2,
    power_controls: 3,
    shutdown: 4,
  };
  const steps = [
    ...(query.stage === "all" || query.stage === "cables" ? cableSteps : []),
    ...operatingSteps,
  ].sort((left, right) => stageOrder[left.stage] - stageOrder[right.stage] || left.order - right.order);
  const provenance = [
    provenanceFor(record.safety_source),
    ...steps.map((step) => step.provenance),
  ];
  const visualStep =
    query.stage === "all" || query.stage === "cables"
      ? cableSteps[0]
      : steps.find((step) => step.stage === query.stage);
  const visualProvenance = visualStep?.provenance;

  return {
    found: true as const,
    status: "documented" as const,
    setup: query.stage,
    recordIds: [...new Set(steps.map((step) => step.recordId))],
    process: record.process,
    prerequisites: record.prerequisites,
    steps,
    visualSource: visualProvenance?.tier === 1 && visualProvenance.page
      ? { file: visualProvenance.source, page: visualProvenance.page }
      : null,
    provenance: [...new Map(provenance.map((item) => [JSON.stringify(item), item] as const)).values()],
  };
}

export type SetupResult = ReturnType<typeof getSetup>;

/**
 * Deterministic host-side rendering, never model-authored (PLAN.md section 3: our code
 * generates procedural diagrams from the graph after traversal, so the agent cannot invent
 * a step or connection). Returns null for a single-step result, where a checklist card adds
 * nothing over the sentence the writer already produces.
 */
export function buildSetupChecklistArtifact(result: SetupResult): SetupChecklistArtifact | null {
  if (!result.found || result.steps.length < 2) return null;
  const steps: SetupChecklistStep[] = result.steps.map((step) => ({
    order: step.order,
    stage: step.stage,
    state: step.state,
    label: "component" in step ? step.component : undefined,
    condition: "condition" in step ? step.condition : undefined,
    instruction: step.instruction,
  }));
  return {
    type: "setup_checklist",
    process: result.process,
    stage: result.setup,
    prerequisites: result.prerequisites,
    steps,
    provenance: result.provenance,
  };
}
