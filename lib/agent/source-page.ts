import { z } from "zod";
import type { SourceVisualArtifact } from "./artifacts";
import { knowledgeManifest, provenanceFor } from "./knowledge";

export const sourcePageKindSchema = z.enum(["document_page", "source_image"]);
export const sourcePageQueryShape = {
  kind: sourcePageKindSchema.describe("document_page for a PDF page, or source_image for a product photograph."),
  source: z.string().trim().min(1).max(160).describe("Exact source path such as files/owner-manual.pdf or product-inside.webp."),
  page: z.number().int().positive().optional().describe("PDF page number; omit for source_image."),
  view: z.enum(["detail", "full"]).default("detail").describe("Prefer the reviewed detail render; full returns the full-page render when available."),
};
export const sourcePageQuerySchema = z.object(sourcePageQueryShape);
export type SourcePageQuery = z.input<typeof sourcePageQuerySchema>;

function sourceMatches(candidate: string, requested: string): boolean {
  return candidate === requested || candidate.endsWith(`/${requested.replace(/^\.?[\\/]/, "")}`);
}

/** Return only pages and images present in the generated, visually reviewed manifest. */
export function getSourcePage(unparsed: SourcePageQuery) {
  const query = sourcePageQuerySchema.parse(unparsed);
  if (query.kind === "document_page") {
    const document = knowledgeManifest.documents.find((item) => sourceMatches(item.source, query.source));
    if (!document) {
      return { found: false as const, status: "unknown_source" as const, kind: query.kind, source: query.source, note: "The requested document is not in the validated manifest." };
    }
    if (query.page === undefined) {
      return { found: false as const, status: "page_required" as const, kind: query.kind, source: document.source, note: "A PDF page number is required." };
    }
    const page = document.pages.find((item) => item.page === query.page);
    if (!page) {
      return { found: false as const, status: "unknown_page" as const, kind: query.kind, source: document.source, page: query.page, note: "That page is not in the validated manifest." };
    }
    const selectedPath = query.view === "detail" ? page.detail_render ?? page.render : page.render ?? page.detail_render;
    return {
      found: true as const,
      status: page.render || page.detail_render ? "reviewed_page" as const : "text_only" as const,
      kind: query.kind,
      source: document.source,
      page: page.page,
      visualReviewed: page.visual_reviewed,
      markdownPath: page.markdown,
      renderPath: page.render,
      detailRenderPath: page.detail_render,
      selectedPath,
      provenance: provenanceFor({ file: document.source, page: page.page }),
    };
  }

  const image = knowledgeManifest.source_images.find((item) => sourceMatches(item.source, query.source));
  if (!image) {
    return { found: false as const, status: "unknown_source" as const, kind: query.kind, source: query.source, note: "The requested source image is not in the validated manifest." };
  }
  const selectedPath = query.view === "detail" ? image.detail_render : image.render;
  return {
    found: true as const,
    status: "reviewed_image" as const,
    kind: query.kind,
    source: image.source,
    visualReviewed: image.visual_reviewed,
    markdownPath: image.markdown,
    renderPath: image.render,
    detailRenderPath: image.detail_render,
    selectedPath,
    provenance: { tier: 1 as const, source: image.source, sourceHash: image.sha256 },
  };
}

export type SourcePageResult = ReturnType<typeof getSourcePage>;

export function sourceVisualUrl(query: SourcePageQuery): string {
  const params = new URLSearchParams({ kind: query.kind, source: query.source, view: query.view ?? "detail" });
  if (query.page !== undefined) params.set("page", String(query.page));
  return `/api/source-assets?${params.toString()}`;
}

/** Only a found, visually reviewed result with a real render path becomes a visible artifact. */
export function buildSourceVisualArtifact(
  query: SourcePageQuery,
  result: SourcePageResult,
): SourceVisualArtifact | null {
  if (!result.found || !result.selectedPath || !result.visualReviewed) return null;
  return {
    type: "source_visual",
    imageUrl: sourceVisualUrl(query),
    page: result.page,
    provenance: result.provenance,
    caption: result.page ? `Reviewed manual page ${result.page}` : "Reviewed source image",
  };
}
