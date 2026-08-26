import { z } from "zod";
import type { ManualSearchResult } from "./manual-search";
import type { JobRiskResult } from "./safety";
import { specQuerySchema, type SpecQuery, type SpecResult } from "./specs";
import type { SetupResult } from "./setups";
import { hasDocumentedSymptomPhrase, type DiagnosisResult } from "./diagnosis";
import type { FaultIndicatorResult } from "./fault-indicators";
import type { ProcessRecommendationResult } from "./process-recommendation";
import type { PowerSourceResult } from "./power-source";
import type { RepairScopeResult } from "./repair-scope";
import type { SourcePageResult } from "./source-page";

export type EvidenceRecord = {
  id: string;
  tool:
    | "lookup_spec"
    | "get_setup"
    | "diagnose_problem"
    | "lookup_fault_indicator"
    | "recommend_process"
    | "search_manual"
    | "assess_job_risk"
    | "assess_power_source"
    | "check_repair_scope"
    | "get_source_page";
  result:
    | SpecResult
    | SetupResult
    | DiagnosisResult
    | FaultIndicatorResult
    | ProcessRecommendationResult
    | ManualSearchResult
    | JobRiskResult
    | PowerSourceResult
    | RepairScopeResult
    | SourcePageResult;
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
const FAULT_INDICATOR_LANGUAGE =
  /\b[a-z]\d{2,4}\b|\b(?:display|screen)\s+(?:says|shows|reads|displays)\b|\b(?:overheat(?:ing)?|thermal|low[- ]voltage|over[- ]voltage)\s+warning\b/i;
const PROCESS_RECOMMENDATION_LANGUAGE =
  /\b(?:which|best|choose|recommend|suitable|better|should\s+i\s+(?:use|choose))\b.{0,120}\b(?:mig|flux(?:[ -]?core|[ -]?cored)|tig|stick|welding\s+process|process)\b|\bwhat\s+(?:welding\s+)?process\b|\b(?:mig|flux(?:[ -]?core|[ -]?cored)|tig|stick)\b.{0,120}\b(?:choose|recommend|best|better|suitable|should\s+i\s+use)\b/i;
const POWER_SOURCE_LANGUAGE =
  /\b(?:power\s+source|generator|inverter|battery\s+bank|ev\s+(?:vehicle|battery)|receptacle|outlet|extension\s+cord|gfci|breaker|ground(?:ed|ing)|phase|frequency|plug\s+into)\b|\b(?:branch|supply|input|dedicated|household|\d+(?:\.\d+)?\s*(?:a|amps?))\s+circuit\b|\bcircuit\b.{0,30}\b(?:breaker|capacity|amperage|amps?)\b/i;
const REPAIR_SCOPE_LANGUAGE =
  /\b(?:repair|replace|fix|open\s+(?:the\s+)?(?:case|cover|enclosure|housing)|internal\s+wiring|circuit\s+board|pcb|technician|diy|bypass|disable|override|modify\s+(?:the\s+)?plug)\b/i;
const SOURCE_PAGE_LANGUAGE =
  /\b(?:show|display|open|view|see)\b.{0,80}\b(?:manual\s+page|source\s+(?:page|image)|diagram|photo|image)\b|\b(?:polarity\s+setup|wire[- ]feed\s+(?:mechanism|diagram)|front\s+panel(?:\s+(?:controls?|diagram|layout|buttons?|display))?|weld(?:ing)?\s+diagnos(?:is|e)(?:\s+(?:image|examples?|diagram))?)\b/i;

/** First-use, cable connections, and polarity hookups — the setup graph, never memory. */
const SETUP_LANGUAGE =
  /\b(?:first[- ]?(?:use|time)|new\s+(?:welder|machine)|unbox\w*|out\s+of\s+the\s+box|getting\s+started|polarity\s+(?:setup|setting|connection)|load(?:ing)?\s+(?:the\s+)?(?:wire|spool)|thread(?:ing)?\s+(?:the\s+)?wire)\b|\b(?:set[- ]?up|start[- ]?up|hook\s*up|connect(?:ing)?)\b.{0,40}\b(?:cables?|ground\s+clamp|electrode\s+holder|gun|torch|wire[- ]feed|welder|machine|checklist|steps?|process)\b|\b(?:mig|flux[- ]?cored?|tig|stick)\b.{0,30}\bset[- ]?up\b/i;

function uniqueMatches(question: string, pattern: RegExp): string[] {
  return [...new Set([...question.matchAll(pattern)].map((match) => match[1]!.toLowerCase()))];
}

/** Return an exact structured intent only when the question identifies one unambiguous fact. */
export function structuredSpecIntent(question: string): SpecQuery | null {
  const processMatches = [
    ...uniqueMatches(question, /\b(mig)\b/gi).map(() => "MIG" as const),
    ...uniqueMatches(question, /\b(flux(?:[ -]?cored?| core))\b/gi).map(() => "flux_cored" as const),
    ...uniqueMatches(question, /\b(tig)\b/gi).map(() => "TIG" as const),
    ...uniqueMatches(question, /\b(stick)\b/gi).map(() => "stick" as const),
  ];
  const processes = [...new Set(processMatches)];
  if (processes.length > 1) return null;

  const voltages = uniqueMatches(question, /\b(120|240)\s*(?:v|vac|volts?)\b/gi).map(Number);
  const amperages = uniqueMatches(question, /\b(\d+(?:\.\d+)?)\s*(?:a|amps?)\b/gi).map(Number);
  if (voltages.length > 1 || amperages.length > 1) return null;

  const spec = /\bduty[ -]?cycle\b/i.test(question)
    ? "duty_cycle"
    : /\b(?:welding[ -]?)?current range\b/i.test(question)
      ? "welding_current_range"
      : /\b(?:maximum\s+)?(?:open[ -]?circuit voltage|ocv)\b/i.test(question)
        ? "maximum_ocv"
        : /\bwire[ -]?feed(?:[ -]?speed)? range\b|\bwire[ -]?feed[ -]?speed\b/i.test(question)
          ? "wire_speed_range"
          : /\b(?:wire[ -]?)?spool\b.*\b(?:capacity|weight|pounds?|lbs?)\b/i.test(question)
            ? "wire_spool_capacity"
            : /\bpolarity\b|\b(?:positive|negative)\s+socket\b|\bwhich socket\b/i.test(question)
              ? "polarity"
              : null;
  if (!spec) return null;

  const parsed = specQuerySchema.safeParse({
    spec,
    process: processes[0],
    inputVoltage: voltages[0],
    amperage: amperages[0],
  });
  return parsed.success ? parsed.data : null;
}

function specResultMatchesIntent(result: SpecResult, intent: SpecQuery): boolean {
  if (result.spec !== intent.spec) return false;
  if (!result.found) {
    return (
      result.query.spec === intent.spec &&
      result.query.process === intent.process &&
      result.query.inputVoltage === intent.inputVoltage &&
      result.query.amperage === intent.amperage
    );
  }
  if (intent.process !== undefined && result.conditions.process !== intent.process) return false;
  if (intent.inputVoltage !== undefined && result.conditions.inputVoltage !== intent.inputVoltage) return false;
  if (
    intent.amperage !== undefined &&
    (result.spec !== "duty_cycle" || result.conditions.amperage !== intent.amperage)
  ) {
    return false;
  }
  return true;
}

export function requiresRiskAssessment(question: string): boolean {
  return RISK_LANGUAGE.test(question);
}

export function requiresFaultIndicatorLookup(question: string): boolean {
  return FAULT_INDICATOR_LANGUAGE.test(question);
}

export function requiresProcessRecommendation(question: string): boolean {
  return PROCESS_RECOMMENDATION_LANGUAGE.test(question);
}

export function requiresPowerSourceAssessment(question: string): boolean {
  return POWER_SOURCE_LANGUAGE.test(question);
}

export function requiresRepairScopeCheck(question: string): boolean {
  return REPAIR_SCOPE_LANGUAGE.test(question);
}

export function requiresSourcePage(question: string): boolean {
  return SOURCE_PAGE_LANGUAGE.test(question);
}

export function requiresSetup(question: string): boolean {
  return SETUP_LANGUAGE.test(question) || /\b(?:initial|complete|full)\s+set[- ]?up\b/i.test(question);
}

export type QuestionRoute = {
  kind: "direct_answer" | "needs_tool" | "needs_clarification" | "needs_safety_review";
  tools: EvidenceRecord["tool"][];
  reason: string;
};

/**
 * Cheap host-side preflight. This is intentionally deterministic and does not
 * call an MCP server or an LLM; it only prevents needless routing work.
 */
export function routeQuestion(question: string): QuestionRoute {
  const text = question.trim();
  if (!text || text.length < 3) {
    return { kind: "needs_clarification", tools: [], reason: "The question is empty or too short." };
  }
  if (/^(?:hi|hello|hey|thanks|thank you|good morning|good afternoon)\b[!. ]*$/i.test(text)) {
    return { kind: "direct_answer", tools: [], reason: "A greeting or acknowledgement needs no manual lookup." };
  }
  if (requiresRiskAssessment(text)) {
    return {
      kind: "needs_safety_review",
      tools: ["assess_job_risk"],
      reason: "The question contains a potentially hazardous action or condition.",
    };
  }

  const tools: EvidenceRecord["tool"][] = [];
  if (structuredSpecIntent(text)) tools.push("lookup_spec");
  if (requiresFaultIndicatorLookup(text)) tools.push("lookup_fault_indicator");
  if (requiresProcessRecommendation(text)) tools.push("recommend_process");
  if (requiresPowerSourceAssessment(text)) tools.push("assess_power_source");
  if (requiresRepairScopeCheck(text)) tools.push("check_repair_scope");
  if (requiresSourcePage(text)) tools.push("get_source_page");
  if (requiresSetup(text)) tools.push("get_setup");
  if (requiresDiagnosis(text)) {
    tools.push("diagnose_problem");
  }
  if (tools.length > 0) {
    return { kind: "needs_tool", tools: [...new Set(tools)], reason: "A deterministic knowledge lookup is relevant." };
  }
  if (/\b(?:which|what|how|can|should|why|does|is|are)\b/i.test(text)) {
    return { kind: "needs_tool", tools: ["search_manual"], reason: "The question asks for a machine-specific fact." };
  }
  return { kind: "needs_clarification", tools: [], reason: "The request is not specific enough to route safely." };
}

const DIAGNOSTIC_LANGUAGE =
  /\b(?:diagnos(?:e|is)|troubleshoot|won't|doesn't|not working|problem|symptom|help me fix)\b/i;

/** Route documented symptom language through the diagnostic graph even when the user does
 * not say "diagnose" or "troubleshoot". The graph matcher is the source of truth, so this
 * automatically covers newly extracted symptoms without adding keyword conditionals. */
export function requiresDiagnosis(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  if (DIAGNOSTIC_LANGUAGE.test(text)) return true;
  return hasDocumentedSymptomPhrase(text);
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
  if (
    requiresFaultIndicatorLookup(question) &&
    !evidence.some((item) => item.tool === "lookup_fault_indicator")
  ) {
    return "The question contains a displayed fault or warning but lookup_fault_indicator was not called.";
  }
  if (
    requiresProcessRecommendation(question) &&
    !evidence.some((item) => item.tool === "recommend_process")
  ) {
    return "The question asks for process selection but recommend_process was not called.";
  }
  if (
    requiresPowerSourceAssessment(question) &&
    !evidence.some((item) => item.tool === "assess_power_source")
  ) {
    return "The question asks about a power source or circuit but assess_power_source was not called.";
  }
  if (
    requiresRepairScopeCheck(question) &&
    !evidence.some((item) => item.tool === "check_repair_scope")
  ) {
    return "The question asks about repair or modification scope but check_repair_scope was not called.";
  }
  if (
    requiresSourcePage(question) &&
    !evidence.some((item) => item.tool === "get_source_page")
  ) {
    return "The question asks to view a source page or image but get_source_page was not called.";
  }
  if (requiresSetup(question) && !evidence.some((item) => item.tool === "get_setup")) {
    return "The question asks about first-use, cable connections, or polarity setup but get_setup was not called.";
  }
  if (
    requiresDiagnosis(question) &&
    !evidence.some((item) => item.tool === "diagnose_problem")
  ) {
    return "The question reports a symptom or asks what to check, but diagnose_problem was not called.";
  }
  const specIntent = structuredSpecIntent(question);
  if (specIntent) {
    const specLookups = evidence
      .filter((item) => item.tool === "lookup_spec")
      .map((item) => item.result as SpecResult);
    if (!specLookups.some((result) => specResultMatchesIntent(result, specIntent))) {
      return "The question requests an exact specification but no matching lookup_spec result completed.";
    }
    if (specLookups.some((result) => !specResultMatchesIntent(result, specIntent))) {
      return "The exact specification lookup included a different process or operating condition.";
    }
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
  const safetyDisposition = riskDisposition(evidence);
  const statements: Record<CheckerOutput["safetyDisposition"], string> = {
    not_assessed: "Answer only from successful evidence records and state explicitly when a lookup did not find a value.",
    stop: "Stop. State the triggered hazards and required actions without providing a bypass or workaround.",
    professional_required: "Explain why the work requires a qualified professional and give only safe next steps from the evidence.",
    correct_before_work: "Identify the conditions that must be corrected before work and preserve every required control.",
    insufficient_information: "Do not assume missing context is safe; ask only the critical questions supplied by the risk evidence.",
    follow_documented_controls: "Answer from the evidence and preserve all documented operating and safety controls.",
  };
  const statement = statements[safetyDisposition];
  return {
    approved: true,
    rejectionReason: null,
    safetyDisposition,
    responsePlan: [
      {
        statement,
        evidenceIds: evidence.map((item) => item.id),
      },
    ],
    prohibitedClaims: ["Unpublished specifications", "Interpolated duty cycles", "Unverified repair instructions"],
  };
}

function numericTokens(value: string): Set<string> {
  return new Set(value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []);
}

const MEASURED_NUMBER_WORD =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-five|thirty|forty|fifty|sixty|seventy|seventy-five|eighty|ninety|hundred)\b\s*(?:percent|minutes?|mins?|amps?|amperes?|volts?|vac|vdc|ipm|pounds?|lbs?|scfh|cfh)\b/i;

function capturedNumbers(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

function allowedStructuredMeasurements(results: readonly SpecResult[]) {
  const allowed = {
    percent: new Set<number>(),
    amperage: new Set<number>(),
    voltage: new Set<number>(),
    minutes: new Set<number>(),
    ipm: new Set<number>(),
    pounds: new Set<number>(),
  };
  for (const result of results) {
    if (!result.found) continue;
    if (result.conditions.inputVoltage !== undefined) allowed.voltage.add(result.conditions.inputVoltage);
    if (result.spec === "duty_cycle") {
      allowed.percent.add(result.value);
      allowed.amperage.add(result.conditions.amperage);
      allowed.minutes.add(result.conditions.periodMinutes);
      allowed.minutes.add(result.conditions.weldMinutes);
      allowed.minutes.add(result.conditions.restMinutes);
      continue;
    }
    const values = Array.isArray(result.value) ? result.value : [result.value];
    const numbers = values.filter((value): value is number => typeof value === "number");
    if (result.unit === "A") numbers.forEach((value) => allowed.amperage.add(value));
    if (result.unit === "VDC") numbers.forEach((value) => allowed.voltage.add(value));
    if (result.unit === "IPM") numbers.forEach((value) => allowed.ipm.add(value));
    if (result.unit === "lb") numbers.forEach((value) => allowed.pounds.add(value));
  }
  return allowed;
}

function validateStructuredMeasurements(text: string, results: readonly SpecResult[]): string | null {
  if (results.length === 0) return null;
  const allowed = allowedStructuredMeasurements(results);
  const groups: Array<[string, number[], Set<number>]> = [
    ["percentage", capturedNumbers(text, /\b(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi), allowed.percent],
    ["amperage", capturedNumbers(text, /\b(\d+(?:\.\d+)?)\s*(?:a\b|amps?\b|amperes?\b)/gi), allowed.amperage],
    ["voltage", capturedNumbers(text, /\b(\d+(?:\.\d+)?)\s*(?:v\b|vac\b|vdc\b|volts?\b)/gi), allowed.voltage],
    ["duration", capturedNumbers(text, /\b(\d+(?:\.\d+)?)\s*(?:[- ]\s*)?(?:minutes?|mins?\b)/gi), allowed.minutes],
    ["wire speed", capturedNumbers(text, /\b(\d+(?:\.\d+)?)\s*ipm\b/gi), allowed.ipm],
    ["spool weight", capturedNumbers(text, /\b(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)\b/gi), allowed.pounds],
  ];
  for (const [kind, values, permitted] of groups) {
    for (const value of values) {
      if (!permitted.has(value)) return `Writer introduced an unsupported structured ${kind}: ${value}`;
    }
  }
  return null;
}

export function validateWriterOutput(
  output: WriterOutput,
  checker: CheckerOutput,
  evidence: readonly EvidenceRecord[],
  question: string,
): string | null {
  const validIds = new Set(evidence.map((item) => item.id));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  for (const paragraph of output.paragraphs) {
    if (paragraph.evidenceIds.some((id) => !validIds.has(id))) {
      return "Writer cited evidence that did not complete successfully.";
    }
    if (MEASURED_NUMBER_WORD.test(paragraph.text)) {
      return "Writer expressed a measured quantity as words; measured quantities must use digits for validation.";
    }
    const cited = paragraph.evidenceIds.map((id) => evidenceById.get(id)!).filter(Boolean);
    const allowedNumbers = numericTokens(
      `${question}\n${JSON.stringify(cited.map((item) => item.result))}`,
    );
    const writtenNumbers = numericTokens(paragraph.text);
    for (const token of writtenNumbers) {
      if (!allowedNumbers.has(token)) return `Writer introduced unsupported numeric token: ${token}`;
    }
    const citedSpecs = cited
      .filter((item) => item.tool === "lookup_spec")
      .map((item) => item.result as SpecResult);
    const structuredFailure = validateStructuredMeasurements(paragraph.text, citedSpecs);
    if (structuredFailure) return structuredFailure;
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

/* "Source" is a welding word before it is a citation word: the machine itself is a power
   source, and a symptom has a source. Those uses are stripped before the citation test so
   "what's the duty cycle of this power source" does not read as a request for pages. */
const DOMAIN_SOURCE =
  /\b(?:power|welding|weld|current|voltage|heat|gas|arc|input)\s+sources?\b|\bsources?\s+of\s+(?:the\s+)?(?:problem|issue|fault|leak|porosity|noise|spatter|heat|gas|current)\b/gi;

const SOURCE_REQUEST: readonly RegExp[] = [
  /\bcite\b|\bcitations?\b|\bcited\b/i,
  /\bsources?\b|\breferences?\b/i,
  /\bwh(?:ich|at)\s+(?:page|section|chapter|figure|table)\b/i,
  /\bpage\s+numbers?\b/i,
  /\bwhere\s+in\s+the\s+(?:manual|guide|chart|book|docs?)\b/i,
  /\bwhere\s+(?:does|did|do|is|are)\b[^?]*\b(?:from|come|coming|say|says|said|stated?)\b/i,
  /\baccording\s+to\b/i,
  /\bback\s+(?:that|this|it)\s+up\b|\bprove\s+(?:that|this|it)\b/i,
  /\bshow\s+me\s+(?:the\s+)?(?:manual|page|source)/i,
];

/**
 * True when the person asking wants to be shown where the answer came from.
 *
 * Provenance is otherwise kept out of the prose: appending it to every paragraph turned
 * each answer into a bibliography, which buried the answer for someone standing at a
 * machine. The evidence itself is unchanged — validation still requires a citable record
 * behind every claim (PLAN.md section 4); this only governs whether the citation is
 * spoken aloud.
 */
export function asksForSources(question: string): boolean {
  const cleaned = question.replace(DOMAIN_SOURCE, " ");
  return SOURCE_REQUEST.some((pattern) => pattern.test(cleaned));
}

export function renderWriterOutput(
  output: WriterOutput,
  evidence: readonly EvidenceRecord[],
  question: string,
): string {
  const includeSources = asksForSources(question);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return output.paragraphs
    .map((paragraph) => {
      if (!includeSources) return paragraph.text;
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
