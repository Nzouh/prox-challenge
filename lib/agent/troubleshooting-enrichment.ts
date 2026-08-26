import type { Provenance } from "./provenance";
import type { SourceVisualArtifact } from "./artifacts";
import type { WeldProcess } from "./domain";
import { getSetup } from "./setups";
import { renderDeterministicSpecAnswer, resolveSpecQuery, type SpecName } from "./specs";
import { buildSourceVisualArtifact, getSourcePage } from "./source-page";

type Check = {
  cause: string;
  check: string;
  remedy: string;
  evidence_queries?: Array<
    | {
        tool: "lookup_spec";
        spec: SpecName;
        inputVoltage?: 120 | 240;
        amperage?: number;
      }
    | {
        tool: "get_setup";
        stage: "cables" | "workpiece" | "consumables" | "power_controls" | "shutdown" | "all";
        required_terms: string[];
      }
  >;
};

export type TroubleshootingSpecific = { text: string; provenance: Provenance };

const VAGUE_INSTRUCTION =
  /\b(?:appropriate|correct|documented|proper|recommended|specified|settings? chart|as necessary)\b/i;
const SPECIFIC_FACT =
  /(?:\d|\b(?:positive|negative)\b|\b(?:DCEP|DCEN)\b|\b(?:VAC|VDC|SCFH|CFH|IPM|amps?|volts?)\b)/i;
function relevantSpecifics(check: Check, processes: readonly WeldProcess[]): TroubleshootingSpecific[] {
  if (!VAGUE_INSTRUCTION.test(check.remedy) || !check.evidence_queries?.length) return [];
  const selected: TroubleshootingSpecific[] = [];
  const seen = new Set<string>();
  for (const query of check.evidence_queries) {
    if (query.tool === "lookup_spec") {
      const relevantProcesses = ["maximum_ocv", "wire_spool_capacity"].includes(query.spec)
        ? [undefined]
        : processes;
      for (const process of relevantProcesses) {
        let result;
        try {
          result = resolveSpecQuery({
            spec: query.spec,
            ...(process ? { process } : {}),
            ...(query.inputVoltage ? { inputVoltage: query.inputVoltage } : {}),
            ...(query.amperage ? { amperage: query.amperage } : {}),
          });
        } catch {
          continue;
        }
        if (!result.found) continue;
        const text = renderDeterministicSpecAnswer(result);
        if (!SPECIFIC_FACT.test(text) || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        selected.push({ text, provenance: result.provenance });
      }
      continue;
    }

    const required = query.required_terms.map((term) => term.toLowerCase());
    for (const process of processes) {
      const setup = getSetup({ process, stage: query.stage });
      if (!setup.found) continue;
      for (const step of setup.steps) {
        const normalized = step.instruction.toLowerCase();
        if (!required.every((term) => normalized.includes(term))) continue;
        const text = `${process}: ${step.instruction}`;
        if (!SPECIFIC_FACT.test(text) || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        selected.push({ text, provenance: step.provenance });
      }
    }
  }
  return selected.slice(0, 6);
}

function supportingVisual(provenance: readonly Provenance[]): SourceVisualArtifact | undefined {
  const manual = provenance.find(
    (source): source is Extract<Provenance, { tier: 1 }> =>
      source.tier === 1 && source.page !== undefined && source.source.toLowerCase().endsWith(".pdf"),
  );
  if (!manual?.page) return undefined;
  const query = {
    kind: "document_page" as const,
    source: manual.source,
    page: manual.page,
    view: "detail" as const,
  };
  return buildSourceVisualArtifact(query, getSourcePage(query)) ?? undefined;
}

/** Resolve vague manual prose against structured MCP-backed knowledge. If no exact value
 * exists, preserve the manual wording and attach its reviewed visual instead of guessing. */
export function enrichTroubleshootingCheck(
  check: Check,
  processes: readonly WeldProcess[],
  provenance: readonly Provenance[],
): { specifics?: TroubleshootingSpecific[]; supportingVisual?: SourceVisualArtifact } {
  if (!VAGUE_INSTRUCTION.test(check.remedy)) return {};
  const specifics = relevantSpecifics(check, processes);
  if (specifics.length > 0) return { specifics };
  const visual = supportingVisual(provenance);
  return visual ? { supportingVisual: visual } : {};
}
