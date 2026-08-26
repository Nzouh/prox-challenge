import type {
  TroubleshootingBranch,
  TroubleshootingFlowArtifact,
} from "./artifacts";
import type { DiagnosisResult } from "./diagnosis";
import { enrichTroubleshootingCheck } from "./troubleshooting-enrichment";

/**
 * Serialises a diagnose_problem traversal into Mermaid source. This replaces the Sideshow
 * round trip: the diagram is generated from the validated graph on our side, so the model
 * never authors diagram text and cannot invent a cause, a check, or a permitted remedy.
 * It renders identically in a local clone and a hosted deployment because nothing external
 * is involved.
 */

/**
 * Mermaid has no escape syntax inside a quoted label, so anything that would terminate the
 * label or the line is replaced with an HTML entity Mermaid renders literally. Text is
 * never truncated — a clipped remedy is a wrong remedy.
 */
function label(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wrap long labels so a node stays readable instead of stretching the whole diagram. */
function wrapped(text: string, width = 34): string {
  const words = label(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length > 0 && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length > 0 ? `${line} ${word}` : word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join("<br/>");
}

/**
 * Every record carries a safety_prerequisite, but most are the generic "follow all safety
 * precautions" line. Promoting that to a callout on every flow trains the user to ignore
 * the callout, so only a prerequisite naming a real action is kept.
 */
const ACTIONABLE_PREREQUISITE = /\b(?:shut off|disconnect|discharge|unplug)\b/i;

export function actionableStopCondition(prerequisite: string): string | undefined {
  return ACTIONABLE_PREREQUISITE.test(prerequisite) ? prerequisite : undefined;
}

function mermaidSource(
  stopCondition: string | undefined,
  branches: readonly TroubleshootingBranch[],
  visibleCount: number,
  showExhausted: boolean,
): string {
  const lines = ["flowchart TD"];
  if (stopCondition) lines.push(`  safety["${wrapped(stopCondition)}"]`);
  const visible = branches.slice(0, visibleCount);
  for (const branch of visible) {
    lines.push(`  ${branch.key}["${wrapped(branch.check)}"]`);
  }
  if (showExhausted) lines.push('  exhausted["Checks exhausted"]');
  if (stopCondition) lines.push(`  safety --> ${branches[0]!.key}`);
  for (let index = 0; index + 1 < visible.length; index += 1) {
    lines.push(`  ${visible[index]!.key} --> ${visible[index + 1]!.key}`);
  }
  if (showExhausted) lines.push(`  ${visible.at(-1)!.key} --> exhausted`);
  if (stopCondition) {
    lines.push("  classDef safety fill:#3a2a24,stroke:#e0705c,color:#f3ede3");
  }
  if (showExhausted) {
    lines.push("  classDef exhausted fill:#2c2620,stroke:#3a332b,color:#f3ede3");
  }
  if (stopCondition) lines.push("  class safety safety");
  if (showExhausted) lines.push("  class exhausted exhausted");
  return lines.join("\n");
}

/**
 * Host-side rendering of a documented symptom as an interactive flowchart. Returns null
 * for an unknown or ambiguous symptom — those results carry no traversal to draw, and a
 * diagram of a guess is worse than no diagram.
 */
export function buildTroubleshootingFlowArtifact(
  result: DiagnosisResult,
): TroubleshootingFlowArtifact | null {
  if (!result.found) return null;
  if (result.checks.length === 0) return null;

  const branches: TroubleshootingBranch[] = result.checks.map((check, index) => {
    const enrichment = enrichTroubleshootingCheck(check, result.processes, result.provenance);
    return {
      key: `c${index + 1}`,
      id: `${result.recordId}:${index + 1}`,
      cause: check.cause,
      check: check.check,
      remedy: check.remedy,
      ...enrichment,
      repairScope: check.repair_scope,
    };
  });

  const stopCondition = actionableStopCondition(result.stopCondition);

  return {
    type: "troubleshooting_flow",
    recordId: result.recordId,
    problem: result.problem,
    processes: result.processes,
    ...(stopCondition ? { stopCondition } : {}),
    mermaidStages: [
      ...branches.map((_, index) => mermaidSource(stopCondition, branches, index + 1, false)),
      mermaidSource(stopCondition, branches, branches.length, true),
    ],
    branches,
    provenance: [
      ...new Map(
        [
          ...result.provenance,
          ...branches.flatMap((branch) => branch.specifics?.map((item) => item.provenance) ?? []),
        ].map((item) => [JSON.stringify(item), item] as const),
      ).values(),
    ],
  };
}
