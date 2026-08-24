import { z } from "zod";
import { provenanceFor } from "./knowledge";
import type { Provenance } from "./provenance";

export const jobRiskQueryShape = {
  activity: z
    .enum(["welding", "setup", "troubleshooting", "repair", "modify_power", "bypass_protection"])
    .describe("The user's intended activity."),
  repairTarget: z
    .enum(["welder_internal", "operator_maintenance", "workpiece", "electrical_supply", "unknown"])
    .optional()
    .describe("What is being repaired; omit when the user has not said."),
  enclosure: z
    .enum(["closed", "open_deenergized", "open_energized", "unknown"])
    .optional()
    .describe("Known enclosure and energy state; omit when not stated."),
  container: z
    .enum(["not_a_container", "open_never_hazardous", "sealed_or_pressurized", "previously_flammable", "unknown"])
    .optional()
    .describe("Whether the workpiece can contain pressure or hazardous residue."),
  workspace: z.enum(["dry", "wet_or_damp", "unknown"]).optional(),
  ventilation: z.enum(["adequate", "inadequate", "confined_space", "unknown"]).optional(),
  combustibles: z.enum(["cleared", "present", "unknown"]).optional(),
  ppe: z.enum(["complete", "incomplete", "unknown"]).optional(),
  coating: z
    .enum(["bare_known", "galvanized", "lead_or_cadmium", "painted_or_unknown", "unknown"])
    .optional(),
  structuralCriticality: z.enum(["noncritical", "vehicle_or_load_bearing", "unknown"]).optional(),
};
export const jobRiskQuerySchema = z.object(jobRiskQueryShape);
export type JobRiskQuery = z.infer<typeof jobRiskQuerySchema>;

type RiskRule = {
  id: string;
  severity: "stop" | "professional_required" | "correct_before_work";
  hazard: string;
  requiredAction: string;
  provenance: Provenance;
};

const manualRepairProvenance = provenanceFor({ file: "files/owner-manual.pdf", page: 46 });
const manualElectricalProvenance = provenanceFor({ file: "files/owner-manual.pdf", page: 4 });
const manualFumeProvenance = provenanceFor({ file: "files/owner-manual.pdf", page: 3 });

const OSHA_FIRE: Provenance = {
  tier: 2,
  source: "OSHA 29 CFR 1926.352 — Fire prevention",
  url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.352",
};
const OSHA_VENTILATION: Provenance = {
  tier: 2,
  source: "OSHA 29 CFR 1926.353 — Ventilation and protection in welding",
  url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.353",
};

function triggeredRules(query: JobRiskQuery): RiskRule[] {
  const rules: RiskRule[] = [];
  if (query.activity === "bypass_protection") {
    rules.push({
      id: "no-safety-bypass",
      severity: "stop",
      hazard: "Bypassing a protection device can expose the user and machine to an uncontrolled fault.",
      requiredAction: "Do not bypass the protection. Record the exact symptom and use documented troubleshooting or a qualified technician.",
      provenance: manualElectricalProvenance,
    });
  }
  if (query.enclosure === "open_energized") {
    rules.push({
      id: "no-energized-internal-work",
      severity: "stop",
      hazard: "The enclosure is open while energized.",
      requiredAction: "Stop, disconnect input power, and do not perform internal work; use a qualified technician.",
      provenance: manualRepairProvenance,
    });
  }
  if (
    query.activity === "repair" &&
    (query.repairTarget === "welder_internal" ||
      query.enclosure === "open_deenergized" ||
      query.enclosure === "open_energized")
  ) {
    rules.push({
      id: "internal-repair-technician",
      severity: "professional_required",
      hazard: "Internal repair or parts replacement is outside the documented operator scope.",
      requiredAction: "Have repairs and parts replacement performed by a certified and licensed technician.",
      provenance: manualRepairProvenance,
    });
  }
  if (query.container === "sealed_or_pressurized" || query.container === "previously_flammable") {
    rules.push({
      id: "container-fire-explosion",
      severity: "stop",
      hazard: "Heating a sealed/pressurized container or one with flammable residue can cause fire or explosion.",
      requiredAction: "Do not weld it. Have the item identified, emptied, cleaned, vented, and assessed by a qualified professional.",
      provenance: OSHA_FIRE,
    });
  }
  if (query.workspace === "wet_or_damp") {
    rules.push({
      id: "wet-electrical-workspace",
      severity: "correct_before_work",
      hazard: "Wet or damp welding conditions increase electric-shock risk.",
      requiredAction: "Do not begin until the work area and equipment are dry and the required electrical protections are confirmed.",
      provenance: manualElectricalProvenance,
    });
  }
  if (query.ventilation === "confined_space" || query.ventilation === "inadequate") {
    rules.push({
      id: "ventilation-required",
      severity: query.ventilation === "confined_space" ? "professional_required" : "correct_before_work",
      hazard: "The described ventilation is insufficient for welding fumes.",
      requiredAction: "Do not weld until appropriate ventilation and any required respiratory/confined-space controls are established.",
      provenance: OSHA_VENTILATION,
    });
  }
  if (["galvanized", "lead_or_cadmium", "painted_or_unknown"].includes(query.coating ?? "")) {
    rules.push({
      id: "hazardous-or-unknown-coating",
      severity: query.coating === "lead_or_cadmium" ? "professional_required" : "correct_before_work",
      hazard: "The coating can create hazardous fumes or has not been identified.",
      requiredAction: "Identify the coating and establish source-specific removal, ventilation, and PPE controls before heating it.",
      provenance: query.coating === "lead_or_cadmium" ? OSHA_VENTILATION : manualFumeProvenance,
    });
  }
  if (query.combustibles === "present") {
    rules.push({
      id: "combustibles-in-hot-work-area",
      severity: "correct_before_work",
      hazard: "Sparks, heat, or slag can reach combustible material.",
      requiredAction: "Remove or protect combustibles and keep suitable fire-extinguishing equipment ready before welding.",
      provenance: OSHA_FIRE,
    });
  }
  if (query.ppe === "incomplete") {
    rules.push({
      id: "welding-ppe-required",
      severity: "correct_before_work",
      hazard: "Required eye, face, skin, and other protection is incomplete.",
      requiredAction: "Obtain and correctly use the PPE required by the manual and the specific task before welding.",
      provenance: manualFumeProvenance,
    });
  }
  if (query.structuralCriticality === "vehicle_or_load_bearing") {
    rules.push({
      id: "safety-critical-structure",
      severity: "professional_required",
      hazard: "A failed weld on a vehicle or load-bearing component can cause severe downstream harm.",
      requiredAction: "Use a qualified welding/engineering professional and the applicable repair procedure.",
      provenance: {
        tier: 3,
        source: "Safety-critical repair classification",
        basis: "Failure consequence inferred from the user-identified vehicle or load-bearing function.",
      },
    });
  }
  return rules;
}

function missingQuestions(query: JobRiskQuery): string[] {
  if (query.activity === "repair" && (!query.repairTarget || query.repairTarget === "unknown")) {
    return ["Are you repairing the welder internally, performing documented operator maintenance, or repairing a separate workpiece?"];
  }
  if (!(query.activity === "welding" || query.repairTarget === "workpiece")) return [];
  const questions: Array<[keyof JobRiskQuery, string]> = [
    ["container", "Is the workpiece sealed, pressurized, or previously used for fuel/chemicals?"],
    ["workspace", "Is the work area completely dry?"],
    ["ventilation", "Is ventilation adequate, and is this a confined space?"],
    ["combustibles", "Have nearby combustibles been removed or protected?"],
    ["ppe", "Do you have the required welding PPE?"],
    ["coating", "Is the base material and every coating positively identified?"],
    ["structuralCriticality", "Is this a vehicle, load-bearing, or otherwise safety-critical component?"],
  ];
  return questions.filter(([field]) => query[field] === undefined || query[field] === "unknown").map(([, question]) => question);
}

export type JobRiskResult = ReturnType<typeof assessJobRisk>;

/** Conservative deterministic evaluator: absent context remains unknown, never safe. */
export function assessJobRisk(unparsed: JobRiskQuery) {
  const query = jobRiskQuerySchema.parse(unparsed);
  const rules = triggeredRules(query);
  const questions = missingQuestions(query);
  const severity: "stop" | "professional_required" | "correct_before_work" | "insufficient_information" | "follow_documented_controls" = rules.some((rule) => rule.severity === "stop")
    ? "stop"
    : rules.some((rule) => rule.severity === "professional_required")
      ? "professional_required"
      : rules.length > 0
        ? "correct_before_work"
        : questions.length > 0
          ? "insufficient_information"
          : "follow_documented_controls";
  return {
    disposition: severity,
    canProceed: severity === "follow_documented_controls",
    triggeredRules: rules,
    unansweredCriticalQuestions: questions,
    note:
      severity === "follow_documented_controls"
        ? "No configured stop rule was triggered; this is not a declaration that welding is inherently safe. Follow the manual and task-specific controls."
        : "Do not treat missing context as safe or bypass a triggered control.",
  };
}
