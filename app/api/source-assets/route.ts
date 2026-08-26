import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { NextRequest } from "next/server";
import { getSourcePage, sourcePageQuerySchema } from "@/lib/agent/source-page";

export const runtime = "nodejs";
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = sourcePageQuerySchema.safeParse({ ...raw, page: raw.page === undefined ? undefined : Number(raw.page) });
  if (!parsed.success) return Response.json({ error: "Invalid source asset query." }, { status: 400 });
  const result = getSourcePage(parsed.data);
  if (!result.found || !result.selectedPath || !result.visualReviewed) return Response.json({ error: "Asset is not a reviewed manifest asset." }, { status: 404 });
  // Every manifest path is "knowledge/...". Statically joining the "knowledge" segment
  // (rather than resolving an arbitrary path against process.cwd()) scopes both the deploy
  // tracer and this traversal check to that one folder instead of the whole repo.
  const withinKnowledge = result.selectedPath.replace(/^knowledge[\\/]/, "");
  const root = resolve(process.cwd(), "knowledge");
  const file = resolve(root, withinKnowledge);
  const rel = relative(root, file);
  if (result.selectedPath === withinKnowledge || !rel || isAbsolute(rel) || rel.startsWith("..")) {
    return Response.json({ error: "Asset is outside the knowledge folder." }, { status: 403 });
  }
  const type = MIME[file.slice(file.lastIndexOf(".")).toLowerCase()];
  if (!type) return Response.json({ error: "Unsupported asset type." }, { status: 415 });
  try { return new Response(await readFile(file), { headers: { "content-type": type, "cache-control": "public, max-age=3600, immutable" } }); }
  catch { return Response.json({ error: "Reviewed render is unavailable." }, { status: 404 }); }
}
