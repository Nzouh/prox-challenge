import { z } from "zod";
import { weldProcessSchema } from "./domain";
import { provenanceFor, readKnowledgeJson } from "./knowledge";

const sourceSchema = z.object({ file: z.string().min(1), page: z.number().int().positive() });
const inputPointSchema = z.object({
  process: weldProcessSchema,
  input_voltage: z.union([z.literal(120), z.literal(240)]),
  output_current: z.number().positive(),
  input_current: z.number().positive(),
});
const powerRecordSchema = z.object({
  id: z.string().min(1),
  supported_source_type: z.literal("grounded_wall_receptacle"),
  supported_voltage_vac: z.array(z.union([z.literal(120), z.literal(240)])).length(2),
  frequency_hz: z.literal(60),
  grounding_required: z.literal(true),
  gfci_required: z.literal(true),
  delayed_action_protection_required: z.literal(true),
  receptacle_must_match_plug: z.literal(true),
  extension_cords_allowed: z.literal(false),
  replacement_cord: z.string().min(1),
  published_input_at_rated_output: z.array(inputPointSchema).min(1),
  source: sourceSchema,
  additional_sources: z.array(sourceSchema).min(1),
});

const powerRecords = z.array(powerRecordSchema).length(1).parse(readKnowledgeJson("power/power-sources.json"));
const powerRecord = powerRecords[0]!;

export const powerSourceTypeSchema = z.enum([
  "wall_receptacle",
  "generator",
  "inverter",
  "battery_bank",
  "ev_vehicle",
  "other",
  "unknown",
]);
export const powerPhaseSchema = z.enum(["single", "three", "unknown"]);

export const powerSourceQueryShape = {
  sourceType: powerSourceTypeSchema.describe("What supplies power: wall receptacle, generator, inverter, battery bank, EV vehicle, other, or unknown."),
  voltageVac: z.number().finite().positive().max(1000).optional().describe("Measured or stated AC input voltage."),
  frequencyHz: z.number().finite().positive().max(1000).optional().describe("Power-source frequency in Hz."),
  phase: powerPhaseSchema.optional().describe("Known phase configuration; the manual does not approve a three-phase connection."),
  continuousAmps: z.number().finite().positive().max(1000).optional().describe("Available continuous current capacity, if known."),
  receptacleMatchesPlug: z.boolean().optional().describe("Whether the receptacle has the same configuration as the supplied plug."),
  grounded: z.boolean().optional().describe("Whether the source is properly grounded."),
  gfciProtected: z.boolean().optional().describe("Whether the receptacle is GFCI protected."),
  delayedActionProtection: z.boolean().optional().describe("Whether delayed-action circuit-breaker or fuse protection is present."),
  extensionCord: z.boolean().optional().describe("Whether an extension cord is being used."),
  powerCordMatches: z.boolean().optional().describe("Whether the supplied or identical replacement cord is being used."),
  process: weldProcessSchema.optional().describe("Optional process used to select a published input-current reference."),
  outputAmps: z.number().finite().positive().max(500).optional().describe("Optional welding output current used with process and voltage."),
};
export const powerSourceQuerySchema = z.object(powerSourceQueryShape);
export type PowerSourceQuery = z.input<typeof powerSourceQuerySchema>;

type CheckStatus = "pass" | "fail" | "unknown" | "not_applicable";
type Check = { id: string; status: CheckStatus; finding: string };

function provenance() {
  return [powerRecord.source, ...powerRecord.additional_sources].map(provenanceFor);
}

function sourceLabel(sourceType: PowerSourceQuery["sourceType"]): string {
  return sourceType === "wall_receptacle" ? "wall receptacle" : sourceType.replace(/_/g, " ");
}

/**
 * Check a proposed supply against only the input conditions published for this machine.
 * Unknown generator, inverter, battery, and EV characteristics remain unsupported rather
 * than being treated as equivalent to a wall outlet.
 */
export function assessPowerSource(unparsed: PowerSourceQuery) {
  const query = powerSourceQuerySchema.parse(unparsed);
  const checks: Check[] = [];
  const unansweredQuestions: string[] = [];
  const stopConditions: string[] = [];
  const safeActions: string[] = [];

  if (query.sourceType !== "wall_receptacle") {
    return {
      found: true as const,
      status: "unsupported_source" as const,
      sourceType: query.sourceType,
      summary: `The manual specifies a grounded wall receptacle, not a ${sourceLabel(query.sourceType)}.`,
      checks: [
        { id: "source-type", status: "fail" as const, finding: "This source type is not approved or characterized in the supplied manual." },
      ],
      stopConditions: ["Do not connect the welder to this source until the manufacturer and a qualified electrician approve the complete setup."],
      safeActions: ["Use only a properly grounded receptacle that matches one of the supplied plugs."],
      unansweredQuestions: ["Is there a manufacturer-approved power-source specification for this source?"],
      provenance: provenance(),
    };
  }

  if (query.voltageVac === undefined) {
    checks.push({ id: "voltage", status: "unknown", finding: "Input voltage was not supplied." });
    unansweredQuestions.push("What is the measured input voltage: 120 VAC or 240 VAC?");
  } else if (query.voltageVac === 120 || query.voltageVac === 240) {
    checks.push({ id: "voltage", status: "pass", finding: `${query.voltageVac} VAC is a published input option.` });
  } else {
    checks.push({ id: "voltage", status: "fail", finding: `${query.voltageVac} VAC is not a published input option.` });
    stopConditions.push("Do not connect the welder to an input voltage other than 120 VAC or 240 VAC.");
  }

  if (query.frequencyHz === undefined) {
    checks.push({ id: "frequency", status: "unknown", finding: "Frequency was not supplied; the manual specifies 60 Hz." });
    unansweredQuestions.push("Is the source 60 Hz?");
  } else if (query.frequencyHz === 60) {
    checks.push({ id: "frequency", status: "pass", finding: "The source is 60 Hz as specified." });
  } else {
    checks.push({ id: "frequency", status: "fail", finding: `${query.frequencyHz} Hz does not match the published 60 Hz input.` });
    stopConditions.push("Do not connect a source with a frequency other than 60 Hz.");
  }

  const booleanChecks: Array<[keyof PowerSourceQuery, string, string, string]> = [
    ["grounded", "grounding", "The source is properly grounded.", "The source is not confirmed properly grounded."],
    ["gfciProtected", "gfci", "GFCI protection is present.", "GFCI protection is absent."],
    ["delayedActionProtection", "delayed-action-protection", "Delayed-action circuit protection is present.", "Delayed-action circuit protection is absent."],
    ["receptacleMatchesPlug", "receptacle", "The receptacle matches the plug.", "The receptacle does not match the plug."],
    ["powerCordMatches", "power-cord", "A supplied or identical replacement cord is used.", "The cord is not confirmed supplied or identical."],
  ];
  for (const [key, id, pass, fail] of booleanChecks) {
    const value = query[key];
    if (value === undefined) {
      checks.push({ id, status: "unknown", finding: `The manual requires this condition, but it was not supplied.` });
      unansweredQuestions.push(`Is ${id.replace(/-/g, " ")} confirmed?`);
    } else if (value) {
      checks.push({ id, status: "pass", finding: pass });
    } else {
      checks.push({ id, status: "fail", finding: fail });
      stopConditions.push(`Do not connect until ${id.replace(/-/g, " ")} is corrected.`);
    }
  }

  if (query.extensionCord === undefined) {
    checks.push({ id: "extension-cord", status: "unknown", finding: "Extension-cord use was not supplied; the manual prohibits extension cords." });
    unansweredQuestions.push("Is an extension cord being used?");
  } else if (!query.extensionCord) {
    checks.push({ id: "extension-cord", status: "pass", finding: "No extension cord is being used." });
  } else {
    checks.push({ id: "extension-cord", status: "fail", finding: "An extension cord is being used, which the manual prohibits." });
    stopConditions.push("Do not use an extension cord with this welder.");
  }

  if (query.phase === "three") {
    checks.push({ id: "phase", status: "fail", finding: "The supplied manual does not approve a three-phase connection." });
    stopConditions.push("Do not adapt a three-phase source to this welder without manufacturer and qualified-electrician approval.");
  } else if (query.phase === "single") {
    checks.push({ id: "phase", status: "pass", finding: "The source is single-phase; the manual's receptacle requirements can be evaluated." });
  } else {
    checks.push({ id: "phase", status: "unknown", finding: "Phase was not supplied; the manual does not publish a separate phase specification." });
  }

  if (query.voltageVac === 120) {
    if (query.continuousAmps === undefined) {
      checks.push({ id: "circuit-capacity", status: "unknown", finding: "The 120 VAC circuit must be rated at 20 A, but capacity was not supplied." });
      unansweredQuestions.push("Is the 120 VAC circuit rated at least 20 A?" );
    } else if (query.continuousAmps >= 20) {
      checks.push({ id: "circuit-capacity", status: "pass", finding: `${query.continuousAmps} A continuous capacity meets the published 20 A 120 VAC receptacle rating.` });
    } else {
      checks.push({ id: "circuit-capacity", status: "fail", finding: `${query.continuousAmps} A continuous capacity is below the published 20 A 120 VAC receptacle rating.` });
      stopConditions.push("Do not connect to a 120 VAC circuit rated below 20 A.");
    }
  } else if (
    query.continuousAmps !== undefined &&
    query.process &&
    query.outputAmps &&
    (query.voltageVac === 120 || query.voltageVac === 240)
  ) {
    const point = powerRecord.published_input_at_rated_output.find(
      (item) => item.process === query.process && item.input_voltage === query.voltageVac && item.output_current === query.outputAmps,
    );
    if (point) {
      const status: CheckStatus = query.continuousAmps >= point.input_current ? "pass" : "fail";
      checks.push({
        id: "circuit-capacity",
        status,
        finding: status === "pass"
          ? `${query.continuousAmps} A continuous capacity meets the published ${point.input_current} A input at this rated output.`
          : `${query.continuousAmps} A continuous capacity is below the published ${point.input_current} A input at this rated output.`,
      });
      if (status === "fail") stopConditions.push("Do not use a circuit whose capacity is below the published input current for the selected rated output.");
    }
  }

  if (query.process && query.outputAmps && (query.voltageVac === 120 || query.voltageVac === 240)) {
    const point = powerRecord.published_input_at_rated_output.find(
      (item) => item.process === query.process && item.input_voltage === query.voltageVac && item.output_current === query.outputAmps,
    );
    if (point) {
      checks.push({ id: "published-input-current", status: "pass", finding: `${point.input_current} A input is published at ${point.output_current} A ${point.process} output on ${point.input_voltage} VAC.` });
    } else {
      checks.push({ id: "published-input-current", status: "not_applicable", finding: "No exact published input-current point matches the supplied process, voltage, and output current." });
    }
  }

  const hasFailure = checks.some((check) => check.status === "fail");
  const hasUnknown = checks.some((check) => check.status === "unknown");
  const status = hasFailure ? "incompatible" : hasUnknown ? "needs_verification" : "compatible";
  if (status === "compatible") safeActions.push("With the power switch OFF, connect only to the matching grounded, GFCI-protected receptacle using the correct supplied cord.");
  else if (status === "needs_verification") safeActions.push("Keep the power switch OFF until every required source condition is confirmed.");

  return {
    found: true as const,
    status,
    sourceType: query.sourceType,
    supportedVoltageVac: powerRecord.supported_voltage_vac,
    publishedFrequencyHz: powerRecord.frequency_hz,
    required120VReceptacleAmps: 20,
    checks,
    stopConditions,
    safeActions,
    unansweredQuestions,
    provenance: provenance(),
  };
}

export type PowerSourceResult = ReturnType<typeof assessPowerSource>;
