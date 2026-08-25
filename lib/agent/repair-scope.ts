import { z } from "zod";
import { provenanceFor, readKnowledgeJson } from "./knowledge";

const sourceSchema = z.object({ file: z.string().min(1), page: z.number().int().positive() });
const repairRecordSchema = z.object({
  id: z.string().min(1),
  classification: z.enum([
    "operator_permitted",
    "deenergized_inspection_only",
    "qualified_technician_required",
    "explicitly_prohibited",
    "not_documented",
  ]),
  patterns: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
  source: sourceSchema,
});
const repairRecords = z.array(repairRecordSchema).min(1).parse(readKnowledgeJson("repair/repair-scope.json"));

export const repairScopeQueryShape = {
  action: z.string().trim().min(1).max(300).describe("The repair, modification, inspection, or maintenance action the user wants to perform."),
  component: z.string().trim().min(1).max(120).optional().describe("Optional component or area involved."),
  powerOff: z.boolean().optional().describe("Whether the power switch is OFF."),
  unplugged: z.boolean().optional().describe("Whether the power cord is unplugged."),
  internalAccess: z.boolean().optional().describe("Whether the action opens the enclosure or accesses internal wiring/electronics."),
  energized: z.boolean().optional().describe("Whether the action would occur while energized or powered."),
  bypassProtection: z.boolean().optional().describe("Whether the action bypasses, disables, overrides, or defeats a safety/protection device."),
};
export const repairScopeQuerySchema = z.object(repairScopeQueryShape);
export type RepairScopeQuery = z.input<typeof repairScopeQuerySchema>;

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value: string) => new Set(normalize(value).split(/\s+/).filter(Boolean));

function textFor(query: RepairScopeQuery): string {
  return normalize([query.action, query.component ?? ""].join(" "));
}

function matchRecord(text: string) {
  const words = tokens(text);
  return repairRecords.find((record) =>
    record.patterns.some((pattern) => {
      const candidate = normalize(pattern);
      return text.includes(candidate) || candidate.split(" ").every((word) => words.has(word));
    }),
  );
}

/** Classify repair scope without turning an undocumented action into permission. */
export function checkRepairScope(unparsed: RepairScopeQuery) {
  const query = repairScopeQuerySchema.parse(unparsed);
  const text = textFor(query);
  const bypass = query.bypassProtection === true || /\b(?:bypass|disable|override|defeat|short(?:ing)? out)\b.*\b(?:protect|thermal|overheat|safety|breaker|fuse|interlock)/i.test(text);
  const internal = query.internalAccess === true || /\b(?:internal|inside the (?:case|enclosure|housing)|open the (?:case|enclosure|housing)|pcb|circuit board|transformer|igbt|wiring)\b/i.test(text);
  const energized = query.energized === true || /\b(?:energized|live|powered on|power on|while it is on)\b/i.test(text);

  if (bypass) {
    const source = provenanceFor({ file: "files/owner-manual.pdf", page: 5 });
    return {
      found: true as const,
      status: "explicitly_prohibited" as const,
      action: query.action,
      rationale: "Do not bypass, disable, override, or defeat a protection or safety device.",
      prerequisites: ["Stop and leave the protection in its documented configuration."],
      prohibitedActions: ["Do not bypass or disable protection."],
      provenance: [source],
    };
  }

  if (energized && internal) {
    return {
      found: true as const,
      status: "explicitly_prohibited" as const,
      action: query.action,
      rationale: "Internal or enclosure work while energized is not an operator action and creates an electric-shock hazard.",
      prerequisites: ["Turn the power switch OFF, unplug the welder, and have a qualified service facility perform internal work."],
      prohibitedActions: ["Do not open or service energized equipment."],
      provenance: [
        provenanceFor({ file: "files/owner-manual.pdf", page: 5 }),
        provenanceFor({ file: "files/owner-manual.pdf", page: 6 }),
      ],
    };
  }

  const record = matchRecord(text);
  if (record && (record.classification === "qualified_technician_required" || internal)) {
    return {
      found: true as const,
      status: "qualified_technician_required" as const,
      action: query.action,
      classification: record.classification,
      rationale: record.rationale,
      prerequisites: ["Do not proceed with internal or electrical repair; contact a qualified/certified service facility."],
      provenance: [provenanceFor(record.source)],
    };
  }

  if (record?.classification === "operator_permitted") {
    const prerequisites: string[] = ["Turn the power switch OFF and unplug the welder before adjustment, cleaning, or service."];
    const missingDeenergization = query.powerOff !== true || query.unplugged !== true;
    if (missingDeenergization) prerequisites.push("Confirm both powerOff=true and unplugged=true before starting.");
    return {
      found: true as const,
      status: missingDeenergization ? "deenergized_inspection_only" as const : "operator_permitted" as const,
      action: query.action,
      classification: record.classification,
      rationale: record.rationale,
      prerequisites,
      provenance: [provenanceFor(record.source), provenanceFor({ file: "files/owner-manual.pdf", page: 5 })],
    };
  }

  return {
    found: false as const,
    status: "not_documented" as const,
    action: query.action,
    rationale: "This action is not classified in the validated repair-scope index.",
    prerequisites: ["Do not begin an undocumented repair; consult the manual or a qualified service facility."],
    provenance: [provenanceFor({ file: "files/owner-manual.pdf", page: 46 })],
  };
}

export type RepairScopeResult = ReturnType<typeof checkRepairScope>;
