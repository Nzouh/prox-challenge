import { z } from "zod";
import { provenanceFor, readKnowledgeJson } from "./knowledge";

const sourceSchema = z.object({ file: z.string().min(1), page: z.number().int().positive() });
const faultIndicatorRecordSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
  documented_as_code: z.boolean(),
  meaning: z.string().min(1),
  actions: z.array(z.string().min(1)).min(1),
  prohibited_actions: z.array(z.string().min(1)).min(1),
  source: sourceSchema,
});

const faultIndicatorRecords = z
  .array(faultIndicatorRecordSchema)
  .min(1)
  .parse(readKnowledgeJson("fault-indicators.json"));

export const faultIndicatorQueryShape = {
  indicator: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe("Exact displayed text, documented warning description, or purported code."),
};
export const faultIndicatorQuerySchema = z.object(faultIndicatorQueryShape);
export type FaultIndicatorQuery = z.infer<typeof faultIndicatorQuerySchema>;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Exact/alias lookup only: an undocumented code cannot inherit actions from a similar condition. */
export function lookupFaultIndicator(unparsed: FaultIndicatorQuery) {
  const query = faultIndicatorQuerySchema.parse(unparsed);
  const normalized = normalize(query.indicator);
  const record = faultIndicatorRecords.find((item) =>
    item.aliases.some((alias) => {
      const candidate = normalize(alias);
      return normalized === candidate || normalized.includes(candidate);
    }),
  );
  if (!record) {
    return {
      found: false as const,
      status: "unknown_indicator" as const,
      indicator: query.indicator,
      note: "That exact indicator is not present in the validated structured fault index.",
      prohibitedActions: ["Do not bypass or disable a protection device."],
      safeActions: [
        "Record the exact displayed text without interpreting it.",
        "Consult the manual for the exact machine revision or the manufacturer.",
      ],
      reviewedSources: [
        provenanceFor({ file: "files/owner-manual.pdf", page: 43 }),
        provenanceFor({ file: "files/owner-manual.pdf", page: 44 }),
      ],
    };
  }
  return {
    found: true as const,
    status: "documented" as const,
    recordId: record.id,
    indicator: record.label,
    documentedAsCode: record.documented_as_code,
    meaning: record.meaning,
    actions: record.actions,
    prohibitedActions: record.prohibited_actions,
    provenance: provenanceFor(record.source),
  };
}

export type FaultIndicatorResult = ReturnType<typeof lookupFaultIndicator>;
