import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { knowledgeManifest } from "./knowledge";
import type { Provenance } from "./provenance";

export const manualSearchQueryShape = {
  query: z.string().trim().min(2).max(300).describe("Plain-language terms to find in the validated corpus."),
  limit: z.number().int().min(1).max(5).default(1).describe("Maximum passages to return; request more only when comparison is needed."),
};
export const manualSearchQuerySchema = z.object(manualSearchQueryShape);
export type ManualSearchQuery = z.infer<typeof manualSearchQuerySchema>;

type IndexedPage = {
  source: string;
  sourceHash: string;
  page?: number;
  markdown: string;
  detailRender: string;
  normalized: string;
  lines: string[];
};

export type ManualSearchHit = {
  score: number;
  passage: string;
  provenance: Provenance;
  sourceView: string;
};

export type ManualSearchResult = {
  found: boolean;
  query: string;
  hits: ManualSearchHit[];
  status: "found" | "not_found";
  note?: string;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "for", "from", "how", "i", "in", "is", "it",
  "my", "of", "on", "or", "the", "this", "to", "what", "when", "with",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((term) => ({ nesting: "nest", nests: "nest" })[term] ?? term)
    .join(" ");
}

function terms(value: string): string[] {
  return [...new Set(normalize(value).split(/\s+/).filter((term) => term.length > 1 && !STOP_WORDS.has(term)))];
}

function readMarkdown(path: string): string {
  if (!path.startsWith("knowledge/") || path.includes("..")) {
    throw new Error(`Manifest contains an invalid knowledge path: ${path}`);
  }
  return readFileSync(join(process.cwd(), "knowledge", path.slice("knowledge/".length)), "utf8");
}

function searchableLines(markdown: string): string[] {
  // Review notes validate visual semantics but should not outrank the source text
  // they summarize. The result still links to the reviewed detail render.
  const primaryExtraction = markdown.split(/\n## Visual review\s*\n/i)[0] ?? markdown;
  return primaryExtraction
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("- Source:") &&
        !line.startsWith("- Render:") &&
        !line.startsWith("- Detail render:") &&
        !line.startsWith("- Local OCR:") &&
        !line.startsWith("- Extraction paths:") &&
        !line.startsWith("- Classification:"),
    );
}

const INDEX: IndexedPage[] = [
  ...knowledgeManifest.documents.flatMap((document) =>
    document.pages
      .filter((page) => page.classification === "text_only" || page.visual_reviewed)
      .map((page) => {
        const markdown = readMarkdown(page.markdown);
        const lines = searchableLines(markdown);
        return {
          source: document.source,
          sourceHash: document.sha256,
          page: page.page,
          markdown: page.markdown,
          detailRender: page.detail_render ?? page.render ?? page.markdown,
          normalized: normalize(lines.join(" ")),
          lines,
        };
      }),
  ),
  ...knowledgeManifest.source_images
    .filter((image) => image.visual_reviewed)
    .map((image) => {
      const markdown = readMarkdown(image.markdown);
      const lines = searchableLines(markdown);
      return {
        source: image.source,
        sourceHash: image.sha256,
        markdown: image.markdown,
        detailRender: image.detail_render,
        normalized: normalize(lines.join(" ")),
        lines,
      };
    }),
];

function pageScore(page: IndexedPage, phrase: string, queryTerms: string[]): number {
  let score = page.normalized.includes(phrase) ? 20 : 0;
  for (const term of queryTerms) {
    const matches = page.normalized.match(new RegExp(`\\b${term}\\b`, "g"))?.length ?? 0;
    score += Math.min(matches, 8);
  }
  const covered = queryTerms.filter((term) => page.normalized.includes(term)).length;
  if (covered === queryTerms.length) score += 10;
  return score;
}

function excerpt(page: IndexedPage, queryTerms: string[]): string {
  const ranked = page.lines
    .map((line, index) => ({
      index,
      // PDF table cells wrap across several lines. Score a local window so
      // "Wire Creates a / Bird's Nest / During Operation" stays one row.
      score: queryTerms.filter((term) =>
        normalize(page.lines.slice(Math.max(0, index - 2), index + 8).join(" ")).includes(term),
      ).length,
      directScore: queryTerms.filter((term) => normalize(line).includes(term)).length,
    }))
    .sort(
      (left, right) =>
        right.score - left.score || right.directScore - left.directScore || left.index - right.index,
    );
  const center = ranked[0]?.index ?? 0;
  const start = Math.max(0, center - 2);
  return page.lines.slice(start, start + 16).join("\n").slice(0, 1_500);
}

/** Deterministic lexical search over pages that passed the extraction review gate. */
export function searchManual(unparsed: z.input<typeof manualSearchQuerySchema>): ManualSearchResult {
  const query = manualSearchQuerySchema.parse(unparsed);
  const queryTerms = terms(query.query);
  if (queryTerms.length === 0) {
    return {
      found: false,
      query: query.query,
      hits: [],
      status: "not_found",
      note: "The query contained no searchable technical terms.",
    };
  }
  const phrase = normalize(query.query);
  const hits = INDEX.map((page) => ({ page, score: pageScore(page, phrase, queryTerms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || (left.page.page ?? 0) - (right.page.page ?? 0))
    .slice(0, query.limit)
    .map(({ page, score }) => ({
      score,
      passage: excerpt(page, queryTerms),
      provenance: {
        tier: 1 as const,
        source: page.source,
        page: page.page,
        sourceHash: page.sourceHash,
      },
      sourceView: page.detailRender,
    }));

  return hits.length
    ? { found: true, query: query.query, hits, status: "found" }
    : {
        found: false,
        query: query.query,
        hits: [],
        status: "not_found",
        note: "No matching passage was found in the validated supplied sources.",
      };
}
