import { z } from "zod";
import type { DutyCycleArtifact } from "./artifacts";
import type { WeldProcess, InputVoltage } from "./domain";
import { inputVoltageSchema, weldProcessSchema } from "./domain";
import { provenanceFor, structuredFacts, type StructuredFact } from "./knowledge";
import type { Provenance } from "./provenance";

export const specNameSchema = z.enum([
  "duty_cycle",
  "welding_current_range",
  "maximum_ocv",
  "wire_speed_range",
  "wire_spool_capacity",
  "polarity",
]);
export type SpecName = z.infer<typeof specNameSchema>;

export const specQueryShape = {
  spec: specNameSchema.describe("Published specification to look up."),
  process: weldProcessSchema.optional().describe("Welding process when the specification depends on it."),
  inputVoltage: inputVoltageSchema.optional().describe("Input supply voltage: 120 or 240 VAC."),
  amperage: z.number().positive().optional().describe("Welding output current in amps for a duty-cycle lookup."),
};

export const specQuerySchema = z.object(specQueryShape).superRefine((value, context) => {
  if (["duty_cycle", "welding_current_range", "polarity"].includes(value.spec) && !value.process) {
    context.addIssue({ code: "custom", path: ["process"], message: `${value.spec} requires a process.` });
  }
  if (["duty_cycle", "welding_current_range"].includes(value.spec) && !value.inputVoltage) {
    context.addIssue({ code: "custom", path: ["inputVoltage"], message: `${value.spec} requires inputVoltage.` });
  }
  if (value.spec === "duty_cycle" && !value.amperage) {
    context.addIssue({ code: "custom", path: ["amperage"], message: "duty_cycle requires amperage." });
  }
});

export type SpecQuery = z.infer<typeof specQuerySchema>;

type FoundBase = {
  found: true;
  spec: SpecName;
  provenance: Provenance;
  recordId: string;
};

export type DutyCycleSpecResult = FoundBase & {
  spec: "duty_cycle";
  value: number;
  unit: "percent";
  conditions: {
    process: WeldProcess;
    inputVoltage: InputVoltage;
    amperage: number;
    periodMinutes: 10;
    weldMinutes: number;
    restMinutes: number;
  };
};

export type GenericFoundSpecResult = FoundBase & {
  spec: Exclude<SpecName, "duty_cycle">;
  value: unknown;
  unit?: string;
  conditions: {
    process?: WeldProcess;
    inputVoltage?: InputVoltage;
  };
};

export type SpecResult =
  | DutyCycleSpecResult
  | GenericFoundSpecResult
  | {
      found: false;
      spec: SpecName;
      query: SpecQuery;
      status: "not_found";
      note: string;
    };

const specLabel: Record<SpecName, string> = {
  duty_cycle: "duty cycle",
  welding_current_range: "welding-current range",
  maximum_ocv: "maximum open-circuit voltage",
  wire_speed_range: "wire-speed range",
  wire_spool_capacity: "maximum wire-spool capacity",
  polarity: "polarity",
};

const processLabel: Record<WeldProcess, string> = {
  MIG: "MIG",
  flux_cored: "flux-cored",
  TIG: "TIG",
  stick: "Stick",
};

function displayRange(value: unknown, unit?: string): string {
  if (Array.isArray(value) && value.length === 2) {
    return `${String(value[0])}–${String(value[1])}${unit ? ` ${unit}` : ""}`;
  }
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

/**
 * Render the narrow exact-spec fast path without asking a second model to restate data.
 * The caller still uses the Anthropic SDK to route the MCP call and establish/resume the
 * conversation; this renderer only removes a redundant checker/writer pass after the
 * host has matched the returned evidence to the user's complete structured intent.
 */
export function renderDeterministicSpecAnswer(result: SpecResult): string {
  if (!result.found) {
    return `The validated sources do not contain an exact published ${specLabel[result.spec]} matching those conditions.`;
  }

  if (result.spec === "duty_cycle") {
    const { process, inputVoltage, amperage, weldMinutes, restMinutes, periodMinutes } =
      result.conditions;
    return `The ${processLabel[process]} duty cycle at ${amperage} A on ${inputVoltage} V is ${result.value}%. That permits ${weldMinutes} minutes of welding and requires ${restMinutes} minutes of rest in each ${periodMinutes}-minute period.`;
  }

  const process = result.conditions.process
    ? `${processLabel[result.conditions.process]} `
    : "";
  const voltage = result.conditions.inputVoltage
    ? ` on ${result.conditions.inputVoltage} V`
    : "";

  if (result.spec === "polarity" && result.value && typeof result.value === "object") {
    const connections = Object.entries(result.value as Record<string, unknown>)
      .map(([component, polarity]) => `${component.replaceAll("_", " ")} is ${String(polarity)}`)
      .join(" and ");
    return `For ${processLabel[result.conditions.process!]}, ${connections}.`;
  }

  return `The published ${process}${specLabel[result.spec]}${voltage} is ${displayRange(result.value, result.unit)}.`;
}

const factProcess: Record<WeldProcess, string> = {
  MIG: "MIG",
  flux_cored: "Flux-cored",
  TIG: "TIG",
  stick: "Stick",
};

const fieldForSpec: Record<Exclude<SpecName, "duty_cycle" | "wire_spool_capacity">, string> = {
  welding_current_range: "welding_current_range",
  maximum_ocv: "maximum_ocv",
  wire_speed_range: "wire_speed_range",
  polarity: "polarity",
};

function findFact(query: SpecQuery): StructuredFact | undefined {
  const field =
    query.spec === "duty_cycle"
      ? "rated_duty_cycles"
      : query.spec === "wire_spool_capacity"
        ? "wire_spool_capacity_max"
        : fieldForSpec[query.spec];

  return structuredFacts.find((fact) => {
    if (fact.field !== field) return false;
    if (query.inputVoltage !== undefined && fact.input_vac !== query.inputVoltage) return false;
    if (!query.process) return fact.process === "all" || query.spec === "wire_spool_capacity";
    if (query.spec === "polarity" && query.process === "MIG") {
      return fact.process === "MIG solid wire";
    }
    return fact.process === factProcess[query.process];
  });
}

/** Pure generated-data lookup shared by the MCP handler, validator, and tests. */
export function resolveSpecQuery(unparsed: SpecQuery): SpecResult {
  const query = specQuerySchema.parse(unparsed);
  const fact = findFact(query);

  if (!fact) {
    return {
      found: false,
      spec: query.spec,
      query,
      status: "not_found",
      note: "No matching published value exists in the visually validated structured data.",
    };
  }

  const provenance = provenanceFor(fact.source);
  if (query.spec === "duty_cycle") {
    const values = z
      .array(z.object({ percent: z.number().positive().max(100), current_a: z.number().positive() }))
      .parse(fact.value);
    const rating = values.find((item) => item.current_a === query.amperage);
    if (!rating || !query.process || !query.inputVoltage || !query.amperage) {
      return {
        found: false,
        spec: query.spec,
        query,
        status: "not_found",
        note: "That exact output current has no published duty-cycle rating in the validated data.",
      };
    }
    return {
      found: true,
      spec: "duty_cycle",
      value: rating.percent,
      unit: "percent",
      conditions: {
        process: query.process,
        inputVoltage: query.inputVoltage,
        amperage: query.amperage,
        periodMinutes: 10,
        weldMinutes: (rating.percent / 100) * 10,
        restMinutes: 10 - (rating.percent / 100) * 10,
      },
      provenance,
      recordId: fact.id,
    };
  }

  return {
    found: true,
    spec: query.spec,
    value: fact.value,
    unit: fact.unit,
    conditions: { process: query.process, inputVoltage: query.inputVoltage },
    provenance,
    recordId: fact.id,
  };
}

/**
 * Host-derived duty-cycle card.
 *
 * Every field the artifact needs is already carried by a successful duty-cycle lookup, so
 * the card is a rendering of validated evidence rather than something the model authors.
 * That removes two failure modes at once: the card can no longer disagree with the number
 * in the prose, and it no longer depends on the question happening to contain a visual
 * noun — "calculate the duty cycle" and "chart the duty cycle" now behave identically.
 */
export function buildDutyCycleArtifact(result: SpecResult): DutyCycleArtifact | null {
  if (!result.found || result.spec !== "duty_cycle") return null;
  return {
    type: "duty_cycle",
    process: result.conditions.process,
    inputVoltage: result.conditions.inputVoltage,
    amperage: result.conditions.amperage,
    dutyCyclePct: result.value,
    periodMinutes: result.conditions.periodMinutes,
    provenance: result.provenance,
  };
}
