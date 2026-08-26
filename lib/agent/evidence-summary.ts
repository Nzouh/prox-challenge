import type { AgentEvidenceSummary, AgentEvidenceValue } from "./events";
import type { EvidenceRecord } from "./orchestration";

function isEvidenceValue(value: unknown): value is AgentEvidenceValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (item) => item === null || ["string", "number", "boolean"].includes(typeof item),
    )
  );
}

/** Stable JSON representation for request-local tool-call and evidence deduplication. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function toolCallKey(tool: string, input: unknown): string {
  return `${tool}:${stableJson(input)}`;
}

/** Keep one copy of identical deterministic evidence before checker/writer prompts. */
export function dedupeEvidence(evidence: readonly EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.tool}:${stableJson(item.result)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeEvidence(item: EvidenceRecord): AgentEvidenceSummary {
  const result = item.result as unknown as Record<string, unknown>;
  const summary: AgentEvidenceSummary = { tool: item.tool };
  if (typeof result.found === "boolean") summary.found = result.found;
  if (typeof result.status === "string") summary.status = result.status;
  if (typeof result.recordId === "string") summary.recordId = result.recordId;
  if (typeof result.spec === "string") summary.spec = result.spec;
  if (isEvidenceValue(result.value)) summary.value = result.value;
  if (typeof result.unit === "string") summary.unit = result.unit;
  if (typeof result.process === "string") summary.process = result.process;
  return summary;
}
