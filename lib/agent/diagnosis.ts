import { z } from "zod";
import { weldProcessSchema } from "./domain";
import { provenanceFor, readKnowledgeJson } from "./knowledge";

const sourceSchema = z.object({ file: z.string().min(1), page: z.number().int().positive() });
export const repairScopeSchema = z.enum([
  "operator_permitted",
  "qualified_technician_required",
]);

const causeSchema = z.object({
  cause: z.string().min(1),
  check: z.string().min(1),
  remedy: z.string().min(1),
  repair_scope: repairScopeSchema,
});

const diagnosticRecordSchema = z.object({
  id: z.string().min(1),
  processes: z.array(weldProcessSchema).min(1),
  problem: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  safety_prerequisite: z.string().min(1),
  causes: z.array(causeSchema).min(1),
  source: sourceSchema,
  additional_sources: z.array(sourceSchema).optional(),
});

const diagnosticRecords = z
  .array(diagnosticRecordSchema)
  .min(5)
  .parse(readKnowledgeJson("troubleshooting/graph.json"));
export const diagnosticRecordCount = diagnosticRecords.length;

export const diagnosisQueryShape = {
  symptom: z.string().trim().min(3).max(300).describe("Observed symptom in the user's words."),
  process: weldProcessSchema.optional().describe("Known welding process; omit when unknown."),
};
export const diagnosisQuerySchema = z.object(diagnosisQueryShape);
export type DiagnosisQuery = z.infer<typeof diagnosisQuerySchema>;

const STOP_WORDS = new Set([
  "a", "an", "and", "but", "does", "during", "has", "i", "in", "is", "it", "my", "not",
  "of", "on", "or", "the", "to", "when", "why", "will", "with",
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function candidatesFor(query: DiagnosisQuery) {
  return query.process
    ? diagnosticRecords.filter((record) => record.processes.includes(query.process!))
    : diagnosticRecords;
}

function matchRecords(query: DiagnosisQuery) {
  const normalized = normalize(query.symptom);
  const candidates = candidatesFor(query);
  const contained = candidates.filter((record) =>
    [record.problem, ...record.aliases].some((label) => {
      const candidate = normalize(label);
      return normalized === candidate || normalized.includes(candidate);
    }),
  );
  if (contained.length > 0) return contained;

  const queryTokens = tokens(query.symptom);
  const scored = candidates
    .map((record) => {
      const labels = tokens([record.problem, ...record.aliases].join(" "));
      const score = [...queryTokens].filter((token) => labels.has(token)).length;
      return { record, score };
    })
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return [];
  return scored.filter((item) => item.score === scored[0]!.score).map((item) => item.record);
}

/** Traverse only documented symptom nodes; ambiguous and unknown symptoms never receive guessed remedies. */
export function diagnoseProblem(unparsed: DiagnosisQuery) {
  const query = diagnosisQuerySchema.parse(unparsed);
  const matches = matchRecords(query);
  if (matches.length === 0) {
    return {
      found: false as const,
      status: "unknown_symptom" as const,
      query,
      note: "No matching symptom exists in the validated troubleshooting graph.",
    };
  }
  if (matches.length > 1) {
    return {
      found: false as const,
      status: "ambiguous_symptom" as const,
      query,
      candidates: matches.map((record) => ({ id: record.id, problem: record.problem, processes: record.processes })),
      note: "More context is required before selecting a troubleshooting path.",
    };
  }
  const record = matches[0]!;
  return {
    found: true as const,
    status: "documented" as const,
    recordId: record.id,
    problem: record.problem,
    processes: record.processes,
    stopCondition: record.safety_prerequisite,
    checks: record.causes,
    provenance: [record.source, ...(record.additional_sources ?? [])].map(provenanceFor),
  };
}

export type DiagnosisResult = ReturnType<typeof diagnoseProblem>;
