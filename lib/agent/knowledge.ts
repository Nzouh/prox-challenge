import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Provenance } from "./provenance";

const sourceSchema = z.object({
  file: z.string().min(1),
  page: z.number().int().positive(),
});

const structuredFactSchema = z.object({
  id: z.string().min(1),
  process: z.string().min(1),
  field: z.string().min(1),
  input_vac: z.union([z.literal(120), z.literal(240)]).optional(),
  value: z.unknown(),
  unit: z.string().min(1).optional(),
  source: sourceSchema,
});

const manifestPageSchema = z.object({
  page: z.number().int().positive(),
  classification: z.enum(["text_only", "complex"]),
  markdown: z.string().min(1),
  render: z.string().nullable(),
  detail_render: z.string().nullable(),
  visual_reviewed: z.boolean(),
});

const manifestDocumentSchema = z.object({
  source: z.string().min(1),
  sha256: z.string().length(64),
  pages: z.array(manifestPageSchema),
});

const manifestSchema = z.object({
  documents: z.array(manifestDocumentSchema),
  source_images: z.array(
    z.object({
      source: z.string().min(1),
      sha256: z.string().length(64),
      markdown: z.string().min(1),
      render: z.string().min(1),
      detail_render: z.string().min(1),
      visual_reviewed: z.boolean(),
    }),
  ),
});

const validationReportSchema = z.object({
  status: z.literal("pass"),
  unresolved_visual_reviews: z.array(z.unknown()).length(0),
});

export type StructuredFact = z.infer<typeof structuredFactSchema>;
export type KnowledgeManifest = z.infer<typeof manifestSchema>;

function readKnowledgeJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "knowledge", relativePath), "utf8"));
}

/** Fail closed at startup if generated knowledge has not passed visual review. */
validationReportSchema.parse(readKnowledgeJson("validation/report.json"));

export const structuredFacts = z
  .array(structuredFactSchema)
  .min(1)
  .parse(readKnowledgeJson("tables/facts.json"));

export const knowledgeManifest = manifestSchema.parse(readKnowledgeJson("manifest.json"));

export function provenanceFor(source: z.infer<typeof sourceSchema>): Provenance {
  const document = knowledgeManifest.documents.find((item) => item.source === source.file);
  if (!document) throw new Error(`Structured fact references unknown source: ${source.file}`);
  const page = document.pages.find((item) => item.page === source.page);
  if (!page || (page.classification === "complex" && !page.visual_reviewed)) {
    throw new Error(`Structured fact references unreviewed source page: ${source.file}#${source.page}`);
  }
  return {
    tier: 1,
    source: source.file,
    page: source.page,
    sourceHash: document.sha256,
  };
}
