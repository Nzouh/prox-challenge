import { z } from "zod";
import type { ManualSearchResult } from "./manual-search";
import type { JobRiskResult } from "./safety";
import type { SpecResult } from "./specs";

export type EvidenceRecord = {
  id: string;
  tool: "lookup_spec" | "search_manual" | "assess_job_risk";
  result: SpecResult | ManualSearchResult | JobRiskResult;
};

export const checkerOutputSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().nullable(),
  safetyDisposition: z.enum([
    "not_assessed",
    "stop",
    "professional_required",
    "correct_before_work",
    "insufficient_information",
    "follow_documented_controls",
  ]),
  responsePlan: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(800),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(8),
  prohibitedClaims: z.array(z.string().trim().min(1).max(300)).max(8),
});
export type CheckerOutput = z.infer<typeof checkerOutputSchema>;

export const writerOutputSchema = z.object({
  paragraphs: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1_500),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .min(1)
    .max(6),
});
export type WriterOutput = z.infer<typeof writerOutputSchema>;

const RISK_LANGUAGE =
  /\b(bypass|disable|override|open(?:ing)?\s+(?:the\s+)?(?:case|cover|enclosure)|internal\s+(?:repair|wiring)|diy\s+(?:fix|repair)|sealed|pressuri[sz]ed|fuel\s+(?:tank|container)|gas\s+(?:tank|container)|confined\s+space|wet|damp|galvani[sz]ed|lead|cadmium|painted|coating|combustible|flammable|no\s+(?:helmet|ppe)|load[- ]bearing|vehicle\s+(?:frame|chassis)|custom\s+battery|battery\s+bank|ev\s+(?:battery|vehicle))\b/i;

export function requiresRiskAssessment(question: string): boolean {
  return RISK_LANGUAGE.test(question);
}

export function riskDisposition(evidence: readonly EvidenceRecord[]): CheckerOutput["safetyDisposition"] {
  const rank: Record<CheckerOutput["safetyDisposition"], number> = {
    not_assessed: 0,
    follow_documented_controls: 1,
    insufficient_information: 2,
    correct_before_work: 3,
    professional_required: 4,
    stop: 5,
  };
  let disposition: CheckerOutput["safetyDisposition"] = "not_assessed";
  for (const item of evidence) {
    if (item.tool !== "assess_job_risk") continue;
    const candidate = (item.result as JobRiskResult).disposition;
    if (rank[candidate] > rank[disposition]) disposition = candidate;
  }
  return disposition;
}

export function validateResearchEvidence(question: string, evidence: readonly EvidenceRecord[]): string | null {
  if (evidence.length === 0) return "No successful evidence-producing MCP call completed.";
  if (requiresRiskAssessment(question) && !evidence.some((item) => item.tool === "assess_job_risk")) {
    return "The question contains a safety-risk signal but assess_job_risk was not called.";
  }
  return null;
}

export function validateCheckerOutput(
  output: CheckerOutput,
  evidence: readonly EvidenceRecord[],
): string | null {
  if (!output.approved) return output.rejectionReason ?? "Safety checker rejected the evidence plan.";
  if (output.responsePlan.length === 0) return "Approved checker output has no response plan.";
  const validIds = new Set(evidence.map((item) => item.id));
  for (const step of output.responsePlan) {
    if (step.evidenceIds.some((id) => !validIds.has(id))) {
      return "Checker response plan references evidence that did not complete successfully.";
    }
  }
  const requiredDisposition = riskDisposition(evidence);
  if (requiredDisposition !== "not_assessed" && output.safetyDisposition !== requiredDisposition) {
    return `Checker changed deterministic safety disposition ${requiredDisposition} to ${output.safetyDisposition}.`;
  }
  if (requiredDisposition === "stop" && !/^(stop|do not)\b/i.test(output.responsePlan[0]?.statement ?? "")) {
    return "A stop disposition must lead with an explicit Stop or Do not instruction.";
  }
  return null;
}

export function defaultCheckerOutput(evidence: readonly EvidenceRecord[]): CheckerOutput {
  return {
    approved: true,
    rejectionReason: null,
    safetyDisposition: riskDisposition(evidence),
    responsePlan: [
      {
        statement: "Answer only from the successful evidence records; state explicitly when a lookup did not find a value.",
        evidenceIds: evidence.map((item) => item.id),
      },
    ],
    prohibitedClaims: ["Unpublished specifications", "Interpolated duty cycles", "Unverified repair instructions"],
  };
}

function numericTokens(value: string): Set<string> {
  return new Set(value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []);
}

export function validateWriterOutput(
  output: WriterOutput,
  checker: CheckerOutput,
  evidence: readonly EvidenceRecord[],
  question: string,
): string | null {
  const validIds = new Set(evidence.map((item) => item.id));
  for (const paragraph of output.paragraphs) {
    if (paragraph.evidenceIds.some((id) => !validIds.has(id))) {
      return "Writer cited evidence that did not complete successfully.";
    }
  }
  const allowedNumbers = numericTokens(
    `${question}\n${JSON.stringify(evidence.map((item) => item.result))}\n${JSON.stringify(checker.responsePlan)}`,
  );
  const writtenNumbers = numericTokens(output.paragraphs.map((item) => item.text).join("\n"));
  for (const token of writtenNumbers) {
    if (!allowedNumbers.has(token)) return `Writer introduced unsupported numeric token: ${token}`;
  }
  if (checker.safetyDisposition === "stop") {
    const opening = output.paragraphs[0]?.text ?? "";
    if (!/^(stop|do not)\b/i.test(opening)) return "Writer did not lead with the required stop instruction.";
    if (/\b(?:here(?:'s| is) how to|steps? to) bypass\b/i.test(opening)) {
      return "Writer provided bypass instructions despite a stop disposition.";
    }
  }
  return null;
}

function collectProvenance(value: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectProvenance(item, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (record.tier === 1 || record.tier === 2 || record.tier === 3) found.push(record);
  for (const nested of Object.values(record)) collectProvenance(nested, found);
  return found;
}

export function renderWriterOutput(output: WriterOutput, evidence: readonly EvidenceRecord[]): string {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return output.paragraphs
    .map((paragraph) => {
      const citations = paragraph.evidenceIds.flatMap((id) =>
        collectProvenance(evidenceById.get(id)?.result),
      );
      const unique = [...new Map(citations.map((item) => [JSON.stringify(item), item])).values()];
      const labels = unique.map((item) => {
        if (item.tier === 1) {
          return `${String(item.source)}${item.page ? ` p.${String(item.page)}` : ""}`;
        }
        if (item.tier === 2) return `${String(item.source)} (${String(item.url)})`;
        return `${String(item.source)} [inference]`;
      });
      return labels.length > 0 ? `${paragraph.text}\n\nSources: ${labels.join("; ")}` : paragraph.text;
    })
    .join("\n\n");
}
