import { z } from "zod";
import { inputVoltageSchema, weldProcessSchema, type WeldProcess } from "./domain";
import { provenanceFor, readKnowledgeJson } from "./knowledge";

const sourceSchema = z.object({ file: z.string().min(1), page: z.number().int().positive() });
export const skillLevelSchema = z.enum(["low", "moderate", "high"]);
export const processMaterialSchema = z.enum([
  "steel",
  "stainless_steel",
  "aluminum",
  "castings",
  "chromoly",
  "magnesium_alloy",
]);
export const processApplicationSchema = z.enum([
  "galvanized_steel",
  "pipe_tubing",
  "general_fabrication",
  "maintenance_repair",
  "sheet_metal",
  "tubing",
  "automotive_body",
  "structural_steel",
  "pressure_vessel",
  "stainless_exhaust",
  "thin_wall_pipe_tubing",
  "bicycle_frame",
  "metal_art",
]);
const chartCleanlinessSchema = z.enum(["more_spatter", "clean_minimal_spatter", "extremely_clean"]);

const processProfileSchema = z.object({
  id: z.string().min(1),
  process: weldProcessSchema,
  required_skill: skillLevelSchema,
  shielding_gas: z.enum(["required", "not_required"]),
  materials: z.array(processMaterialSchema).min(1),
  material_requirements: z.record(z.string(), z.string()),
  thinnest_gauge: z.number().int().min(10).max(24),
  maximum_thickness_inches: z.number().positive().max(0.5),
  thickness_label: z.string().min(1),
  outdoor_or_windy: z.boolean(),
  rusty_or_dirty_steel: z.boolean(),
  cleanliness: chartCleanlinessSchema,
  applications: z.array(processApplicationSchema).min(1),
  advantages: z.array(z.string().min(1)).min(1),
  source: sourceSchema,
});

const processProfiles = z
  .array(processProfileSchema)
  .length(4)
  .parse(readKnowledgeJson("process-selection/chart.json"));

export const processRecommendationQueryShape = {
  inputVoltage: inputVoltageSchema.optional().describe(
    "Known input supply voltage. The chart requires identifying 120 or 240 V but does not rank processes differently by voltage.",
  ),
  skillLevel: skillLevelSchema.optional().describe(
    "User skill: low for beginner, moderate for intermediate, or high for experienced.",
  ),
  shieldingGas: z.enum(["available", "unavailable"]).optional().describe(
    "Whether suitable shielding gas is available. Use unavailable when the user needs a gasless process.",
  ),
  location: z.enum(["indoor", "outdoor_or_windy"]).optional().describe(
    "Welding environment. Use outdoor_or_windy whenever wind may disrupt shielding gas.",
  ),
  material: processMaterialSchema.optional().describe("Base material named by the user."),
  materialCondition: z.enum(["clean", "rusty_or_dirty"]).optional().describe(
    "Surface condition when explicitly stated; never assume an omitted surface is clean.",
  ),
  materialGauge: z.number().int().min(10).max(24).optional().describe(
    "Sheet-metal gauge from 10 through 24. Use thicknessInches for material thicker than 10 gauge.",
  ),
  thicknessInches: z.number().positive().max(4).optional().describe(
    "Material thickness in inches when the user supplies an inch measurement or fraction.",
  ),
  desiredCleanliness: z
    .enum(["more_spatter_acceptable", "clean_minimal_spatter", "extremely_clean"])
    .optional()
    .describe("Required weld appearance or acceptable spatter level."),
  application: processApplicationSchema.optional().describe("Named application when it matches the chart."),
};

export const processRecommendationQuerySchema = z.object(processRecommendationQueryShape);
export type ProcessRecommendationQuery = z.infer<typeof processRecommendationQuerySchema>;

const skillRank = { low: 0, moderate: 1, high: 2 } as const;
const cleanlinessRank = {
  more_spatter: 0,
  clean_minimal_spatter: 1,
  extremely_clean: 2,
} as const;

const processLabel: Record<WeldProcess, string> = {
  MIG: "MIG/GMAW",
  flux_cored: "Flux-cored/FCAW",
  TIG: "TIG/GTAW",
  stick: "Stick/SMAW",
};

function profileConflicts(
  profile: z.infer<typeof processProfileSchema>,
  query: ProcessRecommendationQuery,
): string[] {
  const conflicts: string[] = [];
  if (query.skillLevel && skillRank[query.skillLevel] < skillRank[profile.required_skill]) {
    conflicts.push(`The chart rates this process at ${profile.required_skill} skill.`);
  }
  if (query.shieldingGas === "unavailable" && profile.shielding_gas === "required") {
    conflicts.push("Shielding gas is required.");
  }
  if (query.location === "outdoor_or_windy" && !profile.outdoor_or_windy) {
    conflicts.push("The chart does not recommend this gas-shielded process outdoors or in wind.");
  }
  if (query.material && !profile.materials.includes(query.material)) {
    conflicts.push(`The chart does not list ${query.material.replaceAll("_", " ")} for this process.`);
  }
  if (query.materialCondition === "rusty_or_dirty" && !profile.rusty_or_dirty_steel) {
    conflicts.push("The chart does not describe this process as forgiving on rusty or dirty steel.");
  }
  if (query.materialGauge && query.materialGauge > profile.thinnest_gauge) {
    conflicts.push(`The material is thinner than the charted ${profile.thickness_label} range.`);
  }
  if (query.thicknessInches && query.thicknessInches > profile.maximum_thickness_inches) {
    conflicts.push(`The material exceeds the charted ${profile.thickness_label} range.`);
  }
  if (query.desiredCleanliness === "clean_minimal_spatter" && cleanlinessRank[profile.cleanliness] < 1) {
    conflicts.push("The chart classifies this process as producing more spatter.");
  }
  if (query.desiredCleanliness === "extremely_clean" && profile.cleanliness !== "extremely_clean") {
    conflicts.push("The chart does not classify this process as extremely clean.");
  }
  if (query.application && !profile.applications.includes(query.application)) {
    conflicts.push("The chart does not list the requested application for this process.");
  }
  return conflicts;
}

function scoreProfile(
  profile: z.infer<typeof processProfileSchema>,
  query: ProcessRecommendationQuery,
): { score: number; matches: string[] } {
  let score = 0;
  const matches: string[] = [];
  if (query.skillLevel) {
    score += query.skillLevel === profile.required_skill ? 2 : 1;
    matches.push(`Compatible with ${query.skillLevel} skill; chart rating is ${profile.required_skill}.`);
  }
  if (query.shieldingGas === "unavailable" && profile.shielding_gas === "not_required") {
    score += 2;
    matches.push("No shielding gas is required.");
  } else if (query.shieldingGas === "available") {
    matches.push(
      profile.shielding_gas === "required"
        ? "Available shielding gas satisfies the process requirement."
        : "The process does not require the available shielding gas.",
    );
  }
  if (query.location === "outdoor_or_windy" && profile.outdoor_or_windy) {
    score += 3;
    matches.push("The chart recommends it for outdoor or windy conditions.");
  } else if (query.location === "indoor") {
    matches.push("The stated location does not conflict with the chart.");
  }
  if (query.material) {
    score += 2;
    matches.push(`The chart lists ${query.material.replaceAll("_", " ")}.`);
  }
  if (query.materialCondition === "rusty_or_dirty") {
    score += 3;
    matches.push("The chart describes it as forgiving on rusty or dirty steel.");
  } else if (query.materialCondition === "clean") {
    matches.push("The stated clean surface does not conflict with the chart.");
  }
  if (query.materialGauge) {
    score += 2;
    matches.push(`${query.materialGauge} gauge falls within the charted thin-material boundary.`);
  }
  if (query.thicknessInches) {
    score += 2;
    matches.push(`${query.thicknessInches} inch does not exceed the charted maximum thickness.`);
  }
  if (query.desiredCleanliness) {
    const desiredRank = query.desiredCleanliness === "extremely_clean" ? 2 : query.desiredCleanliness === "clean_minimal_spatter" ? 1 : 0;
    score += profile.cleanliness === query.desiredCleanliness ? 3 : cleanlinessRank[profile.cleanliness] >= desiredRank ? 2 : 1;
    matches.push(`Chart cleanliness: ${profile.cleanliness.replaceAll("_", " ")}.`);
  }
  if (query.application) {
    score += 3;
    matches.push(`The chart lists ${query.application.replaceAll("_", " ")} as a typical application.`);
  }
  return { score, matches };
}

function publicProfile(profile: z.infer<typeof processProfileSchema>, query: ProcessRecommendationQuery) {
  const requirement = query.material ? profile.material_requirements[query.material] : undefined;
  const scored = scoreProfile(profile, query);
  return {
    recordId: profile.id,
    process: profile.process,
    processLabel: processLabel[profile.process],
    score: scored.score,
    matchedCriteria: scored.matches,
    requiredSkill: profile.required_skill,
    shieldingGas: profile.shielding_gas,
    chartedMaterials: profile.materials,
    materialRequirement: requirement ?? null,
    thicknessRange: profile.thickness_label,
    cleanliness: profile.cleanliness,
    advantages: profile.advantages,
    provenance: provenanceFor(profile.source),
  };
}

const decisionFields: Array<keyof ProcessRecommendationQuery> = [
  "skillLevel",
  "shieldingGas",
  "location",
  "material",
  "materialCondition",
  "materialGauge",
  "thicknessInches",
  "desiredCleanliness",
  "application",
];

/** Deterministically traverse only the visually validated process-selection chart. */
export function recommendProcess(unparsed: ProcessRecommendationQuery) {
  const query = processRecommendationQuerySchema.parse(unparsed);
  const suppliedDecisionFields = decisionFields.filter((field) => query[field] !== undefined);
  const commonProvenance = provenanceFor(processProfiles[0]!.source);
  const inputVoltageNote = query.inputVoltage
    ? `The selection chart says to identify ${query.inputVoltage} V input, but it does not rank the four processes differently by voltage.`
    : "Input voltage is still needed for machine-capacity and settings checks; the selection chart does not rank processes by voltage.";

  if (suppliedDecisionFields.length === 0) {
    return {
      found: false as const,
      status: "insufficient_information" as const,
      query,
      missingInformation: ["skillLevel", "shieldingGas", "location", "material", "thickness", "desiredCleanliness"],
      note: "At least one chart decision factor is required before processes can be compared.",
      inputVoltageNote,
      provenance: commonProvenance,
    };
  }

  const evaluated = processProfiles.map((profile) => ({
    profile,
    conflicts: profileConflicts(profile, query),
  }));
  const compatible = evaluated
    .filter((item) => item.conflicts.length === 0)
    .map((item) => publicProfile(item.profile, query))
    .sort((left, right) => right.score - left.score || left.process.localeCompare(right.process));

  if (compatible.length === 0) {
    return {
      found: false as const,
      status: "unsupported" as const,
      query,
      note: "No process satisfies all stated selection-chart constraints. Do not relax or invent a requirement silently.",
      rejectedProcesses: evaluated.map((item) => ({
        process: item.profile.process,
        processLabel: processLabel[item.profile.process],
        conflicts: item.conflicts,
      })),
      inputVoltageNote,
      provenance: commonProvenance,
    };
  }

  const highestScore = compatible[0]!.score;
  const recommendations = compatible.filter((item) => item.score === highestScore);
  const alternatives = compatible.filter((item) => item.score !== highestScore);
  const missingInformation = decisionFields
    .filter((field) => query[field] === undefined)
    .map(String);

  return {
    found: true as const,
    status: recommendations.length === 1 ? "recommended" as const : "multiple_matches" as const,
    query,
    recommendations,
    alternatives,
    missingInformation: recommendations.length > 1 ? missingInformation : [],
    inputVoltageNote,
    provenance: commonProvenance,
  };
}

export type ProcessRecommendationResult = ReturnType<typeof recommendProcess>;
