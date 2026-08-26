import assert from "node:assert/strict";
import test from "node:test";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  diagramNeed,
  dutyCycleArtifactSchema,
  polarityMapArtifactSchema,
  setupChecklistArtifactSchema,
  troubleshootingFlowArtifactSchema,
  sourceVisualArtifactSchema,
} from "../lib/agent/artifacts";
import { resultToEvent } from "../lib/agent/result";
import { responseCacheKey, VerifiedResponseCache } from "../lib/agent/response-cache";
import {
  buildDutyCycleArtifact,
  renderDeterministicSpecAnswer,
  resolveSpecQuery,
} from "../lib/agent/specs";
import { searchManual } from "../lib/agent/manual-search";
import { assessJobRisk } from "../lib/agent/safety";
import { buildSetupChecklistArtifact, getSetup, type SetupResult } from "../lib/agent/setups";
import { buildPolarityMapArtifact } from "../lib/agent/polarity-map";
import { buildTroubleshootingFlowArtifact } from "../lib/agent/troubleshooting-flow";
import { diagnoseProblem, diagnosticRecordCount } from "../lib/agent/diagnosis";
import { lookupFaultIndicator } from "../lib/agent/fault-indicators";
import { recommendProcess } from "../lib/agent/process-recommendation";
import { assessPowerSource } from "../lib/agent/power-source";
import { checkRepairScope } from "../lib/agent/repair-scope";
import {
  buildSourceVisualArtifact,
  getSourcePage,
  sourcePageQuerySchema,
  sourceVisualUrl,
  type SourcePageResult,
} from "../lib/agent/source-page";
import { researchSessionOptions } from "../lib/agent/session";
import {
  dedupeEvidence,
  stableJson,
  summarizeEvidence,
  toolCallKey,
} from "../lib/agent/evidence-summary";
import {
  asksForSources,
  defaultCheckerOutput,
  requiresFaultIndicatorLookup,
  requiresProcessRecommendation,
  requiresPowerSourceAssessment,
  requiresRepairScopeCheck,
  requiresDiagnosis,
  requiresSetup,
  requiresSourcePage,
  requiresRiskAssessment,
  routeQuestion,
  structuredSpecIntent,
  validateCheckerOutput,
  validateResearchEvidence,
  validateWriterOutput,
  type EvidenceRecord,
} from "../lib/agent/orchestration";

test("routeQuestion uses a cheap deterministic preflight", () => {
  assert.equal(routeQuestion("What is the duty cycle for MIG at 200 A on 240 V?").kind, "needs_tool");
  assert.deepEqual(routeQuestion("What is the duty cycle for MIG at 200 A on 240 V?").tools, ["lookup_spec"]);
  assert.equal(routeQuestion("Can I bypass the thermal cutoff?").kind, "needs_safety_review");
  assert.deepEqual(routeQuestion("hello").tools, []);
  assert.equal(routeQuestion("hello").kind, "direct_answer");
  assert.equal(routeQuestion("which process should I use outdoors on rusty steel?").tools[0], "recommend_process");
});

test("known symptoms route to diagnosis without requiring troubleshooting keywords", () => {
  const question = "My weld has porosity. What should I check?";
  assert.equal(requiresDiagnosis(question), true);
  assert.deepEqual(routeQuestion(question).tools, ["diagnose_problem"]);
  assert.equal(requiresDiagnosis("What's the duty cycle for MIG welding at 200A on 240V?"), false);
  assert.equal(requiresDiagnosis("What's the polarity setup for flux-cored?"), false);

  const manualOnly: EvidenceRecord[] = [
    { id: "manual", tool: "search_manual", result: searchManual({ query: question }) },
  ];
  assert.match(validateResearchEvidence(question, manualOnly) ?? "", /diagnose_problem was not called/);

  const diagnostic: EvidenceRecord[] = [
    { id: "diagnosis", tool: "diagnose_problem", result: diagnoseProblem({ symptom: question }) },
  ];
  assert.equal(validateResearchEvidence(question, diagnostic), null);
});

test("open-circuit specifications do not trigger power-source assessment", () => {
  const specification = "What is the maximum open-circuit voltage?";
  assert.equal(requiresPowerSourceAssessment(specification), false);
  assert.deepEqual(routeQuestion(specification).tools, ["lookup_spec"]);

  for (const question of [
    "Can I run the welder on a 20A circuit?",
    "Does this branch circuit have enough capacity?",
    "Which breaker does this circuit require?",
  ]) {
    assert.equal(requiresPowerSourceAssessment(question), true, question);
  }
});

test("evidence summaries are semantic and duplicate evidence is collapsed", () => {
  const unknown: EvidenceRecord = {
    id: "first",
    tool: "diagnose_problem",
    result: diagnoseProblem({ symptom: "the flux capacitor rattles" }),
  };
  assert.deepEqual(summarizeEvidence(unknown), {
    tool: "diagnose_problem",
    found: false,
    status: "unknown_symptom",
  });

  const duplicate = { ...unknown, id: "second" };
  assert.deepEqual(dedupeEvidence([unknown, duplicate]), [unknown]);
  assert.equal(stableJson({ process: "MIG", spec: "polarity" }), stableJson({ spec: "polarity", process: "MIG" }));
  assert.equal(
    toolCallKey("lookup_spec", { process: "MIG", spec: "polarity" }),
    toolCallKey("lookup_spec", { spec: "polarity", process: "MIG" }),
  );
});

test("get_setup returns structured clarification when context is incomplete", () => {
  assert.equal(requiresSetup("How do I do the initial setup?"), true);
  const result = getSetup({ stage: "all" });
  assert.equal(result.found, false);
  assert.equal(result.status, "insufficient_information");
  if (result.status === "insufficient_information") {
    assert.deepEqual(result.requiredFields, ["process"]);
  }
});

test("diagramNeed is a local presentation decision, not an MCP lookup", () => {
  assert.equal(diagramNeed("Show me a flowchart for TIG startup"), "flowchart");
  assert.equal(diagramNeed("Draw a sequence diagram for the tool calls"), "sequence");
  assert.equal(
    diagramNeed("Walk me through startup: first connect power, then connect gas, finally test the torch"),
    "flowchart",
  );
  assert.equal(diagramNeed("What is the duty cycle at 200 A?"), "none");
});

const publishedLookup = resolveSpecQuery({
  spec: "duty_cycle",
  process: "MIG",
  inputVoltage: 240,
  amperage: 200,
});

test("lookup_spec resolves generated and visually reviewed manual data", () => {
  assert.equal(publishedLookup.found, true);
  assert.equal(publishedLookup.spec, "duty_cycle");
  if (!publishedLookup.found || publishedLookup.spec !== "duty_cycle") return;
  assert.equal(publishedLookup.value, 25);
  assert.equal(publishedLookup.conditions.periodMinutes, 10);
  assert.equal(publishedLookup.provenance.source, "files/owner-manual.pdf");
  assert.equal(publishedLookup.provenance.tier, 1);
  assert.equal(publishedLookup.recordId, "mig-240-duty");
  assert.equal(publishedLookup.conditions.weldMinutes, 2.5);
  assert.equal(publishedLookup.conditions.restMinutes, 7.5);
});

test("research sessions persist and resume the Anthropic SDK session id", () => {
  assert.deepEqual(researchSessionOptions(), { persistSession: true });
  assert.deepEqual(researchSessionOptions("session-123"), {
    persistSession: true,
    resume: "session-123",
  });
});

test("lookup_spec supports non-duty-cycle facts", () => {
  const range = resolveSpecQuery({
    spec: "welding_current_range",
    process: "MIG",
    inputVoltage: 120,
  });
  assert.equal(range.found, true);
  if (!range.found) return;
  assert.deepEqual(range.value, [30, 140]);
  assert.equal(range.unit, "A");

  const polarity = resolveSpecQuery({ spec: "polarity", process: "flux_cored" });
  assert.equal(polarity.found, true);
  if (!polarity.found) return;
  assert.deepEqual(polarity.value, { ground: "positive", wire_feed_power: "negative" });
});

test("get_setup preserves process-specific required and disconnected cable states", () => {
  const flux = getSetup({ process: "flux_cored", stage: "cables" });
  assert.equal(flux.found, true);
  if (!flux.found) return;
  assert.equal(
    flux.steps.find((step) => step.stage === "cables" && step.component === "ground_clamp")?.instruction,
    "Connect the ground clamp to the positive terminal.",
  );
  assert.equal(
    flux.steps.find((step) => step.stage === "cables" && step.component === "wire_feed_power")?.instruction,
    "Connect wire-feed power to the negative terminal.",
  );

  const stick = getSetup({ process: "stick", stage: "cables" });
  assert.equal(stick.found, true);
  if (!stick.found) return;
  assert.equal(
    stick.steps.find((step) => step.stage === "cables" && step.component === "wire_feed_power")?.state,
    "disconnected",
  );
});

test("get_setup returns focused operating stages without mixing process instructions", () => {
  const tigControls = getSetup({ process: "TIG", stage: "power_controls" });
  assert.equal(tigControls.found, true);
  if (!tigControls.found) return;
  assert.ok(tigControls.steps.every((step) => step.stage === "power_controls"));
  assert.match(JSON.stringify(tigControls.steps), /select TIG/i);
  assert.doesNotMatch(JSON.stringify(tigControls.steps), /wire-feed control cable/i);

  const fluxComplete = getSetup({ process: "flux_cored", stage: "all" });
  assert.equal(fluxComplete.found, true);
  if (!fluxComplete.found) return;
  assert.ok(fluxComplete.steps.some((step) => step.stage === "shutdown"));
  assert.doesNotMatch(JSON.stringify(fluxComplete.steps), /open the cylinder valve|argon cylinder/i);
});

test("get_setup uses the manual's exact gas-flow ranges instead of vague chart references", () => {
  const mig = getSetup({ process: "MIG", stage: "power_controls" });
  assert.equal(mig.found, true);
  if (mig.found) {
    assert.ok(mig.steps.some((step) => /20–30 SCFH/.test(step.instruction)));
  }

  const tig = getSetup({ process: "TIG", stage: "power_controls" });
  assert.equal(tig.found, true);
  if (tig.found) {
    assert.ok(tig.steps.some((step) => /10–25 SCFH/.test(step.instruction)));
  }
});

test("diagnose_problem returns documented checks and technician boundaries", () => {
  const result = diagnoseProblem({ symptom: "The wire forms a bird nest in the feeder", process: "MIG" });
  assert.equal(result.found, true);
  if (!result.found) return;
  assert.equal(result.recordId, "wire-birds-nest");
  assert.ok(result.checks.some((item) => item.cause === "Excess wire-feed pressure"));
  assert.ok(
    result.checks.some(
      (item) => item.cause === "Damaged liner" && item.repair_scope === "qualified_technician_required",
    ),
  );
  assert.match(result.stopCondition, /disconnect it from power/i);
});

test("diagnose_problem does not guess an unsupported symptom", () => {
  const result = diagnoseProblem({ symptom: "The machine makes a purple spiral" });
  assert.equal(result.found, false);
  assert.equal(result.status, "unknown_symptom");
});

test("diagnose_problem covers every remaining weak-arc troubleshooting row", () => {
  assert.equal(diagnosticRecordCount, 12);
  const wire = diagnoseProblem({ symptom: "weak arc strength", process: "MIG" });
  assert.equal(wire.found, true);
  if (wire.found) assert.equal(wire.recordId, "wire-weak-arc");

  const electrode = diagnoseProblem({ symptom: "weak arc strength", process: "stick" });
  assert.equal(electrode.found, true);
  if (electrode.found) assert.equal(electrode.recordId, "tig-stick-weak-arc");
});

test("troubleshooting_flow is derived verbatim from one documented diagnosis", () => {
  const diagnosis = diagnoseProblem({ symptom: "wire feeds but no arc", process: "MIG" });
  const flow = buildTroubleshootingFlowArtifact(diagnosis);
  assert.ok(flow);
  const parsed = troubleshootingFlowArtifactSchema.parse(flow);
  assert.equal(parsed.recordId, "wire-feeds-no-arc");
  assert.equal(parsed.branches.length, 3);
  assert.deepEqual(parsed.branches[0], {
    key: "c1",
    id: "wire-feeds-no-arc:1",
    cause: "Improper ground connection",
    check: "Check clamp contact and clean the workpiece near the clamp and weld.",
    remedy: "Make a clean, secure workpiece connection.",
    repairScope: "operator_permitted",
  });
  assert.equal(parsed.provenance[0]?.tier, 1);
  assert.equal(parsed.provenance[0]?.page, 43);
  assert.equal(parsed.stopCondition, undefined);
});

test("troubleshooting_flow keeps only actionable shutdown prerequisites", () => {
  const flow = buildTroubleshootingFlowArtifact(
    diagnoseProblem({ symptom: "wire stops during welding", process: "MIG" }),
  );
  assert.ok(flow?.stopCondition);
  assert.match(flow.stopCondition, /Shut off the welder/);
});

test("troubleshooting expansion gives the exact documented regulator range", () => {
  const flow = buildTroubleshootingFlowArtifact(
    diagnoseProblem({ symptom: "porosity", process: "MIG" }),
  );
  assert.ok(flow);
  const gasFlow = flow.branches.find((branch) => /regulator/i.test(branch.check));
  assert.match(gasFlow?.specifics?.map((item) => item.text).join(" ") ?? "", /20–30 SCFH/);
  assert.equal(gasFlow?.remedy, "Set the documented gas flow.");
  assert.equal(flow.provenance.some((source) => source.tier === 1 && source.page === 20), true);
});

test("troubleshooting expansion gives exact polarity terminal mappings", () => {
  for (const symptom of ["porosity", "mig arc unstable"]) {
    const flow = buildTroubleshootingFlowArtifact(
      diagnoseProblem({ symptom, process: "MIG" }),
    );
    assert.ok(flow);
    const polarity = flow.branches.find((branch) => /polarity/i.test(branch.cause));
    const specifics = polarity?.specifics?.map((item) => item.text).join(" ") ?? "";
    assert.match(specifics, /MIG.*ground is negative.*wire feed power is positive/i);
    assert.match(
      specifics,
      /flux-cored.*ground is positive.*wire feed power is negative/i,
    );
    assert.match(polarity?.remedy ?? "", /^Correct the polarity/);
    assert.equal(
      flow.provenance.some(
        (source) =>
          source.tier === 1 &&
          source.source === "files/quick-start-guide.pdf" &&
          source.page === 2,
      ),
      true,
    );
  }
});

test("vague remedies never borrow unrelated specifics and fall back to a reviewed visual", () => {
  const flow = buildTroubleshootingFlowArtifact(
    diagnoseProblem({ symptom: "wire feeds but no arc", process: "MIG" }),
  );
  assert.ok(flow);
  const contactTip = flow.branches.find((branch) => /sized contact tip/i.test(branch.cause));
  assert.equal(contactTip?.specifics, undefined);
  assert.equal(contactTip?.supportingVisual?.type, "source_visual");
  assert.doesNotMatch(JSON.stringify(contactTip), /wire-speed|spool capacity|polarity/i);
});

test("troubleshooting_flow fails closed for unknown and ambiguous symptoms", () => {
  assert.equal(
    buildTroubleshootingFlowArtifact(diagnoseProblem({ symptom: "purple sparks everywhere" })),
    null,
  );
  assert.equal(
    buildTroubleshootingFlowArtifact(diagnoseProblem({ symptom: "welder does not function" })),
    null,
  );
});

test("lookup_fault_indicator rejects invented codes without borrowing a known fix", () => {
  const result = lookupFaultIndicator({ indicator: "E99" });
  assert.equal(result.found, false);
  if (result.found) return;
  assert.equal(result.status, "unknown_indicator");
  assert.doesNotMatch(JSON.stringify(result.safeActions), /cool|reset|voltage/i);
  assert.match(JSON.stringify(result.prohibitedActions), /do not bypass/i);
});

test("research validation requires the fault index for purported display codes", () => {
  const question = 'The display says "E99." What does it mean?';
  assert.equal(requiresFaultIndicatorLookup(question), true);
  assert.match(
    validateResearchEvidence(question, [
      { id: "manual", tool: "search_manual", result: searchManual({ query: "E99" }) },
    ]) ?? "",
    /lookup_fault_indicator/,
  );
});

test("lookup_fault_indicator returns only actions for an explicitly matched warning", () => {
  const result = lookupFaultIndicator({ indicator: "overheating warning" });
  assert.equal(result.found, true);
  if (!result.found) return;
  assert.equal(result.recordId, "thermal-protection-warning");
  assert.equal(result.documentedAsCode, false);
  assert.match(JSON.stringify(result.actions), /Power Switch ON/);
});

test("recommend_process selects flux-cored for a beginner outdoors without gas on rusty steel", () => {
  const result = recommendProcess({
    skillLevel: "low",
    shieldingGas: "unavailable",
    location: "outdoor_or_windy",
    material: "steel",
    materialCondition: "rusty_or_dirty",
  });
  assert.equal(result.found, true);
  if (!result.found) return;
  assert.equal(result.status, "recommended");
  assert.deepEqual(result.recommendations.map((item) => item.process), ["flux_cored"]);
  assert.equal(result.provenance.source, "files/selection-chart.pdf");
  assert.equal(result.provenance.tier, 1);
  if (result.provenance.tier === 1) assert.equal(result.provenance.page, 1);
});

test("recommend_process selects TIG only when high-skill clean-weld constraints support it", () => {
  const result = recommendProcess({
    skillLevel: "high",
    shieldingGas: "available",
    location: "indoor",
    material: "stainless_steel",
    materialGauge: 24,
    desiredCleanliness: "extremely_clean",
  });
  assert.equal(result.found, true);
  if (!result.found) return;
  assert.deepEqual(result.recommendations.map((item) => item.process), ["TIG"]);
  assert.equal(result.recommendations[0]?.materialRequirement, "DC TIG is required.");
});

test("recommend_process respects the charted maximum thickness", () => {
  const result = recommendProcess({
    skillLevel: "moderate",
    shieldingGas: "unavailable",
    location: "outdoor_or_windy",
    material: "steel",
    thicknessInches: 0.5,
  });
  assert.equal(result.found, true);
  if (!result.found) return;
  assert.deepEqual(result.recommendations.map((item) => item.process), ["stick"]);
  assert.equal(result.recommendations[0]?.thicknessRange, "10 gauge to 1/2 inch");
});

test("recommend_process preserves special equipment requirements", () => {
  const result = recommendProcess({
    skillLevel: "low",
    shieldingGas: "available",
    location: "indoor",
    material: "aluminum",
    application: "automotive_body",
  });
  assert.equal(result.found, true);
  if (!result.found) return;
  assert.deepEqual(result.recommendations.map((item) => item.process), ["MIG"]);
  assert.equal(result.recommendations[0]?.materialRequirement, "A spool gun is required.");
});

test("recommend_process asks for context on a tie and rejects incompatible constraints", () => {
  const tied = recommendProcess({ material: "steel" });
  assert.equal(tied.found, true);
  if (tied.found) {
    assert.equal(tied.status, "multiple_matches");
    assert.equal(tied.recommendations.length, 4);
    assert.ok(tied.missingInformation.includes("skillLevel"));
  }

  const missing = recommendProcess({ inputVoltage: 120 });
  assert.equal(missing.found, false);
  assert.equal(missing.status, "insufficient_information");

  const unsupported = recommendProcess({
    skillLevel: "low",
    shieldingGas: "unavailable",
    material: "aluminum",
  });
  assert.equal(unsupported.found, false);
  assert.equal(unsupported.status, "unsupported");
});

test("process-selection questions require recommend_process evidence", () => {
  const question = "Which welding process should I choose for rusty steel outdoors?";
  assert.equal(requiresProcessRecommendation(question), true);
  assert.match(
    validateResearchEvidence(question, [
      { id: "manual", tool: "search_manual", result: searchManual({ query: question }) },
    ]) ?? "",
    /recommend_process/,
  );
  const recommendation = recommendProcess({
    location: "outdoor_or_windy",
    material: "steel",
    materialCondition: "rusty_or_dirty",
  });
  assert.equal(
    validateResearchEvidence(question, [
      { id: "selection", tool: "recommend_process", result: recommendation },
    ]),
    null,
  );
});

test("assess_power_source requires more than a matching voltage", () => {
  const incomplete = assessPowerSource({ sourceType: "wall_receptacle", voltageVac: 240 });
  assert.equal(incomplete.found, true);
  if (!incomplete.found) return;
  assert.equal(incomplete.status, "needs_verification");
  assert.ok(incomplete.unansweredQuestions.length >= 5);

  const safe = assessPowerSource({
    sourceType: "wall_receptacle",
    voltageVac: 240,
    frequencyHz: 60,
    phase: "single",
    grounded: true,
    gfciProtected: true,
    delayedActionProtection: true,
    receptacleMatchesPlug: true,
    powerCordMatches: true,
    extensionCord: false,
    process: "MIG",
    outputAmps: 200,
  });
  assert.equal(safe.status, "compatible");
  assert.match(JSON.stringify(safe), /25\.5/);

  const battery = assessPowerSource({ sourceType: "battery_bank", voltageVac: 240 });
  assert.equal(battery.status, "unsupported_source");
  assert.match(JSON.stringify(battery.stopConditions), /Do not connect/i);

  const undersized = assessPowerSource({
    sourceType: "wall_receptacle",
    voltageVac: 120,
    continuousAmps: 15,
    frequencyHz: 60,
    phase: "single",
    grounded: true,
    gfciProtected: true,
    delayedActionProtection: true,
    receptacleMatchesPlug: true,
    powerCordMatches: true,
    extensionCord: false,
  });
  assert.equal(undersized.status, "incompatible");
  assert.match(JSON.stringify(undersized.checks), /below the published 20 A/);
});

test("check_repair_scope separates operator work, technician work, and bypasses", () => {
  const external = checkRepairScope({ action: "replace the contact tip", powerOff: true, unplugged: true });
  assert.equal(external.status, "operator_permitted");

  const internal = checkRepairScope({ action: "replace the main PCB" });
  assert.equal(internal.status, "qualified_technician_required");
  assert.match(JSON.stringify(internal.provenance), /page.*46/);

  const bypass = checkRepairScope({ action: "bypass the thermal protection", bypassProtection: true });
  assert.equal(bypass.status, "explicitly_prohibited");
  assert.match(JSON.stringify(bypass.prohibitedActions), /Do not bypass/i);

  const unknown = checkRepairScope({ action: "rewind the transformer" });
  assert.equal(unknown.status, "qualified_technician_required");
});

test("get_source_page returns only reviewed manifest assets", () => {
  const page = getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 7, view: "detail" });
  assert.equal(page.found, true);
  if (!page.found) return;
  assert.equal(page.status, "reviewed_page");
  assert.match(page.selectedPath ?? "", /page-07-detail\.png$/);
  assert.equal(page.provenance.source, "files/owner-manual.pdf");

  const image = getSourcePage({ kind: "source_image", source: "product-inside.webp", view: "detail" });
  assert.equal(image.found, true);
  if (!image.found) return;
  assert.match(image.selectedPath ?? "", /product-inside-detail\.png$/);

  const miss = getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 999, view: "detail" });
  assert.equal(miss.found, false);
});

test("source_visual accepts only the validated asset URL contract", () => {
  const page = getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 7, view: "detail" });
  assert.equal(page.found, true);
  if (!page.found) return;
  const visual = sourceVisualArtifactSchema.parse({
    type: "source_visual",
    imageUrl: sourceVisualUrl({ kind: "document_page", source: "files/owner-manual.pdf", page: 7, view: "detail" }),
    page: 7,
    provenance: page.provenance,
    caption: "Reviewed manual page 7",
  });
  assert.match(visual.imageUrl, /source-assets/);
  assert.throws(() => sourceVisualArtifactSchema.parse({ ...visual, imageUrl: "/knowledge/renders/owner-manual/page-07-detail.png" }));
  assert.equal(getSourcePage({ kind: "document_page", source: "files/not-in-manifest.pdf", page: 7, view: "detail" }).found, false);
  assert.equal(getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 999, view: "detail" }).found, false);
});

test("source_visual selects the requested render and only for a reviewed manifest asset", () => {
  const detailQuery = { kind: "document_page" as const, source: "files/owner-manual.pdf", page: 7, view: "detail" as const };
  const detail = buildSourceVisualArtifact(detailQuery, getSourcePage(detailQuery));
  assert.ok(detail);
  assert.match(detail!.imageUrl, /view=detail/);
  assert.match(detail!.imageUrl, /page=7/);
  assert.equal(detail!.page, 7);
  assert.equal(detail!.caption, "Reviewed manual page 7");
  assert.equal(setupChecklistArtifactSchema.safeParse(detail).success, false);
  assert.equal(sourceVisualArtifactSchema.parse(detail).type, "source_visual");

  const fullQuery = { kind: "document_page" as const, source: "files/owner-manual.pdf", page: 7, view: "full" as const };
  const full = buildSourceVisualArtifact(fullQuery, getSourcePage(fullQuery));
  assert.ok(full);
  assert.match(full!.imageUrl, /view=full/);

  const image = buildSourceVisualArtifact(
    { kind: "source_image", source: "product-inside.webp", view: "detail" },
    getSourcePage({ kind: "source_image", source: "product-inside.webp", view: "detail" }),
  );
  assert.ok(image);
  assert.equal(image!.page, undefined);
  assert.equal(image!.caption, "Reviewed source image");
});

test("source_visual can target a frontend mounted at a public base path", () => {
  const previous = process.env.ARC_PUBLIC_BASE_PATH;
  process.env.ARC_PUBLIC_BASE_PATH = "/arc";
  try {
    const query = { kind: "document_page" as const, source: "files/owner-manual.pdf", page: 7, view: "detail" as const };
    const artifact = buildSourceVisualArtifact(query, getSourcePage(query));
    assert.ok(artifact);
    assert.match(artifact!.imageUrl, /^\/arc\/api\/source-assets\?/);
  } finally {
    if (previous === undefined) delete process.env.ARC_PUBLIC_BASE_PATH;
    else process.env.ARC_PUBLIC_BASE_PATH = previous;
  }
});

test("get_source_page rejects unknown sources, unknown pages, and missing page numbers", () => {
  assert.equal(getSourcePage({ kind: "document_page", source: "files/not-in-manifest.pdf", page: 1 }).found, false);
  assert.equal(getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 999 }).found, false);
  assert.equal(getSourcePage({ kind: "source_image", source: "not-a-real-image.webp" }).found, false);

  const noPage = getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf" });
  assert.equal(noPage.found, false);
  if (noPage.found) return;
  assert.equal(noPage.status, "page_required");

  assert.throws(() => sourcePageQuerySchema.parse({ kind: "document_page", source: "files/owner-manual.pdf", page: 0 }));
  assert.throws(() => sourcePageQuerySchema.parse({ kind: "document_page", source: "files/owner-manual.pdf", page: -1 }));
  assert.throws(() => sourcePageQuerySchema.parse({ kind: "book_page", source: "files/owner-manual.pdf", page: 1 }));
});

test("an unreviewed or path-less render never becomes a source_visual artifact", () => {
  const unreviewed: SourcePageResult = {
    found: true,
    status: "reviewed_page",
    kind: "document_page",
    source: "files/owner-manual.pdf",
    page: 12,
    visualReviewed: false,
    markdownPath: "knowledge/markdown/owner-manual/page-12.md",
    renderPath: "knowledge/renders/owner-manual/page-12.png",
    detailRenderPath: null,
    selectedPath: "knowledge/renders/owner-manual/page-12.png",
    provenance: { tier: 1, source: "files/owner-manual.pdf", page: 12 },
  };
  assert.equal(
    buildSourceVisualArtifact({ kind: "document_page", source: "files/owner-manual.pdf", page: 12 }, unreviewed),
    null,
  );

  const noPath: SourcePageResult = { ...unreviewed, visualReviewed: true, selectedPath: null };
  assert.equal(
    buildSourceVisualArtifact({ kind: "document_page", source: "files/owner-manual.pdf", page: 12 }, noPath),
    null,
  );

  const notFound = getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 999 });
  assert.equal(
    buildSourceVisualArtifact({ kind: "document_page", source: "files/owner-manual.pdf", page: 999 }, notFound),
    null,
  );
});

test("routing sends first-use, polarity, wire-feed, front-panel, and weld-diagnosis questions to the right lookup", () => {
  const setupOnlyQuestions = [
    "How do I set this welder up for the first time?",
    "I just unboxed it — what do I connect first?",
    "How do I load the wire spool for MIG?",
    "How do I hook up the ground clamp and MIG gun?",
  ];
  for (const question of setupOnlyQuestions) {
    assert.equal(requiresSetup(question), true, question);
    assert.equal(requiresSourcePage(question), false, question);
    assert.equal(routeQuestion(question).tools.includes("get_setup"), true, question);
    assert.match(
      validateResearchEvidence(question, [
        { id: "manual", tool: "search_manual", result: searchManual({ query: question }) },
      ]) ?? "",
      /get_setup/,
      question,
    );
  }

  // "Polarity setup" is deliberately dual-routed: it is both a setup procedure and a
  // question a reviewed diagram answers, so it must require both kinds of evidence.
  const dualRouted = "What's the polarity setup for stick welding?";
  assert.equal(requiresSetup(dualRouted), true);
  assert.equal(requiresSourcePage(dualRouted), true);
  assert.match(
    validateResearchEvidence(dualRouted, [
      { id: "manual", tool: "search_manual", result: searchManual({ query: dualRouted }) },
    ]) ?? "",
    /get_source_page/,
  );
  const sourceEvidence: EvidenceRecord = {
    id: "source",
    tool: "get_source_page",
    result: getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 7 }),
  };
  assert.match(validateResearchEvidence(dualRouted, [sourceEvidence]) ?? "", /get_setup/);

  for (const question of [
    "What's on the front panel?",
    "Show the front panel controls.",
    "Can you walk me through weld diagnosis for this porosity?",
    "Show the wire-feed mechanism diagram.",
  ]) {
    assert.equal(requiresSourcePage(question), true, question);
  }

  const setup = getSetup({ process: "MIG", stage: "cables" });
  assert.equal(
    validateResearchEvidence("How do I hook up the ground clamp and MIG gun?", [
      { id: "setup", tool: "get_setup", result: setup },
    ]),
    null,
  );
});

test("setup_checklist renders a deterministic multi-step artifact grouped by stage", () => {
  const setup = getSetup({ process: "MIG", stage: "all" });
  assert.equal(setup.found, true);
  const artifact = buildSetupChecklistArtifact(setup);
  assert.ok(artifact);
  const parsed = setupChecklistArtifactSchema.parse(artifact);
  assert.equal(parsed.process, "MIG");
  assert.equal(parsed.steps.length, setup.found ? setup.steps.length : -1);
  assert.ok(parsed.steps.some((step) => step.stage === "cables" && step.label === "ground_clamp"));
  assert.ok(parsed.steps.some((step) => step.stage === "shutdown"));
  assert.ok(parsed.provenance.length >= 1);
  assert.equal(dutyCycleArtifactSchema.safeParse(artifact).success, false);
});

test("get_setup nominates a reviewed manual visual for the requested stage", () => {
  const complete = getSetup({ process: "MIG", stage: "all" });
  assert.equal(complete.found, true);
  if (complete.found) {
    assert.deepEqual(complete.visualSource, { file: "files/quick-start-guide.pdf", page: 2 });
  }
  const consumables = getSetup({ process: "MIG", stage: "consumables" });
  assert.equal(consumables.found, true);
  if (consumables.found) {
    assert.deepEqual(consumables.visualSource, { file: "files/owner-manual.pdf", page: 11 });
  }
});

test("setup_checklist is withheld for a single-step result", () => {
  const single = getSetup({ process: "stick", stage: "consumables" });
  assert.equal(single.found, true);
  if (!single.found) return;
  assert.equal(single.steps.length, 1);
  assert.equal(buildSetupChecklistArtifact(single), null);
});

test("new tool intents require their matching evidence", () => {
  assert.equal(requiresPowerSourceAssessment("Can I run it from a battery bank?"), true);
  assert.equal(requiresRepairScopeCheck("Can I replace the internal PCB myself?"), true);
  assert.equal(requiresSourcePage("Show me the manual page for the front controls."), true);
  assert.equal(requiresSourcePage("Which socket does the TIG torch use? Show the polarity setup."), true);
  assert.equal(requiresSourcePage("Show the wire-feed mechanism diagram."), true);
  assert.equal(requiresSourcePage("Show the weld diagnosis examples."), true);
  assert.match(
    validateResearchEvidence("Can I run it from a battery bank?", [
      { id: "manual", tool: "search_manual", result: searchManual({ query: "battery bank" }) },
      { id: "risk", tool: "assess_job_risk", result: assessJobRisk({ activity: "modify_power" }) },
    ]) ?? "",
    /assess_power_source/,
  );
  assert.match(
    validateResearchEvidence("Can I replace the internal PCB myself?", [
      { id: "manual", tool: "search_manual", result: searchManual({ query: "internal repair" }) },
    ]) ?? "",
    /check_repair_scope/,
  );
  assert.match(
    validateResearchEvidence("Show me the manual page for the front controls.", [
      { id: "manual", tool: "search_manual", result: searchManual({ query: "front controls" }) },
    ]) ?? "",
    /get_source_page/,
  );
});

test("lookup_spec returns an explicit miss instead of interpolating duty cycle", () => {
  const result = resolveSpecQuery({
    spec: "duty_cycle",
    process: "MIG",
    inputVoltage: 240,
    amperage: 190,
  });
  assert.equal(result.found, false);
  if (result.found) return;
  assert.equal(result.status, "not_found");
});

test("an exact documented miss is valid evidence and does not trigger a redundant research retry", () => {
  const question = "What's the duty cycle for MIG welding at 190A on 240V?";
  const result = resolveSpecQuery({
    spec: "duty_cycle",
    process: "MIG",
    inputVoltage: 240,
    amperage: 190,
  });
  assert.equal(
    validateResearchEvidence(question, [
      { id: "missing-duty", tool: "lookup_spec", result },
    ]),
    null,
  );
  assert.match(renderDeterministicSpecAnswer(result), /do not contain an exact published duty cycle/i);
});

test("exact specification questions require the matching structured lookup", () => {
  const question = "What's the duty cycle for MIG welding at 200A on 240V?";
  assert.deepEqual(structuredSpecIntent(question), {
    spec: "duty_cycle",
    process: "MIG",
    inputVoltage: 240,
    amperage: 200,
  });
  assert.match(
    validateResearchEvidence(question, [
      { id: "manual", tool: "search_manual", result: searchManual({ query: question }) },
    ]) ?? "",
    /matching lookup_spec/,
  );

  const wrongProcess = resolveSpecQuery({
    spec: "duty_cycle",
    process: "TIG",
    inputVoltage: 240,
    amperage: 175,
  });
  assert.match(
    validateResearchEvidence(question, [
      { id: "correct", tool: "lookup_spec", result: publishedLookup },
      { id: "wrong", tool: "lookup_spec", result: wrongProcess },
    ]) ?? "",
    /different process or operating condition/,
  );
  assert.equal(
    validateResearchEvidence(question, [
      { id: "correct", tool: "lookup_spec", result: publishedLookup },
    ]),
    null,
  );
});

test("final validation preserves duty-cycle value, units, and linked conditions", () => {
  const question = "What's the duty cycle for MIG welding at 200A on 240V?";
  const evidence: EvidenceRecord[] = [
    { id: "duty", tool: "lookup_spec", result: publishedLookup },
  ];
  const checker = defaultCheckerOutput(evidence);

  assert.match(
    validateWriterOutput(
      { paragraphs: [{ text: "The duty cycle is 20%: 2 minutes welding and 8 minutes cooling.", evidenceIds: ["duty"] }] },
      checker,
      evidence,
      question,
    ) ?? "",
    /unsupported numeric token|unsupported structured/,
  );
  assert.match(
    validateWriterOutput(
      { paragraphs: [{ text: "Weld for eight minutes.", evidenceIds: ["duty"] }] },
      checker,
      evidence,
      question,
    ) ?? "",
    /measured quantity as words/,
  );
  assert.equal(
    validateWriterOutput(
      { paragraphs: [{ text: "The duty cycle is 25%: 2.5 minutes welding and 7.5 minutes resting in a 10-minute period.", evidenceIds: ["duty"] }] },
      checker,
      evidence,
      question,
    ),
    null,
  );
  assert.equal(
    renderDeterministicSpecAnswer(publishedLookup),
    "The MIG duty cycle at 200 A on 240 V is 25%. That permits 2.5 minutes of welding and requires 7.5 minutes of rest in each 10-minute period.",
  );
});

test("search_manual returns reviewed source passages and a detail view", () => {
  const result = searchManual({ query: "bird nest wire feed", limit: 2 });
  assert.equal(result.found, true);
  assert.equal(result.hits[0]?.provenance.source, "files/owner-manual.pdf");
  assert.equal(result.hits[0]?.provenance.tier, 1);
  if (result.hits[0]?.provenance.tier === 1) {
    assert.equal(result.hits[0].provenance.page, 42);
  }
  assert.match(result.hits[0]?.passage ?? "", /Excess wire feed pressure/);
  assert.match(result.hits[0]?.passage ?? "", /Damaged liner/);
  assert.match(result.hits[0]?.sourceView ?? "", /page-42-detail\.png$/);
});

test("assess_job_risk blocks protection bypass and preserves unknown context", () => {
  const result = assessJobRisk({ activity: "bypass_protection" });
  assert.equal(result.disposition, "stop");
  assert.equal(result.canProceed, false);
  assert.ok(result.triggeredRules.some((rule) => rule.id === "no-safety-bypass"));
});

test("assess_job_risk never assumes omitted welding context is safe", () => {
  const result = assessJobRisk({ activity: "welding", workspace: "dry" });
  assert.equal(result.disposition, "insufficient_information");
  assert.equal(result.canProceed, false);
  assert.ok(result.unansweredCriticalQuestions.length >= 5);
});

test("research validation requires risk evidence for bypass and DIY repair questions", () => {
  const question = "Can I bypass the overheating protection and repair it myself?";
  assert.equal(requiresRiskAssessment(question), true);
  assert.match(
    validateResearchEvidence(question, [
      { id: "manual", tool: "search_manual", result: searchManual({ query: "thermal protection" }) },
    ]) ?? "",
    /assess_job_risk/,
  );
});

test("final writer checker rejects unsupported numbers", () => {
  const risk = assessJobRisk({ activity: "bypass_protection" });
  const evidence: EvidenceRecord[] = [{ id: "risk", tool: "assess_job_risk", result: risk }];
  const checker = defaultCheckerOutput(evidence);
  checker.responsePlan[0] = {
    statement: "Stop. Do not bypass the protection.",
    evidenceIds: ["risk"],
  };
  const failure = validateWriterOutput(
    { paragraphs: [{ text: "Stop. Wait 99 minutes, then bypass it.", evidenceIds: ["risk"] }] },
    checker,
    evidence,
    "Can I bypass it?",
  );
  assert.match(failure ?? "", /unsupported numeric token/);
});

test("the provisional writer plan preserves deterministic stop dispositions", () => {
  const risk = assessJobRisk({ activity: "bypass_protection" });
  const evidence: EvidenceRecord[] = [{ id: "risk", tool: "assess_job_risk", result: risk }];
  const checker = defaultCheckerOutput(evidence);
  assert.equal(checker.safetyDisposition, "stop");
  assert.match(checker.responsePlan[0]?.statement ?? "", /^(stop|do not)\b/i);
  assert.equal(validateCheckerOutput(checker, evidence), null);
});

test("a duty-cycle card is derived from the lookup rather than authored", () => {
  assert.equal(publishedLookup.found, true);
  assert.equal(publishedLookup.spec, "duty_cycle");
  if (!publishedLookup.found || publishedLookup.spec !== "duty_cycle") return;

  const card = buildDutyCycleArtifact(publishedLookup);
  // Every field is the lookup's own, so the card cannot disagree with the prose beside it.
  assert.deepEqual(
    card,
    dutyCycleArtifactSchema.parse({
      type: "duty_cycle",
      process: publishedLookup.conditions.process,
      inputVoltage: publishedLookup.conditions.inputVoltage,
      amperage: publishedLookup.conditions.amperage,
      dutyCyclePct: publishedLookup.value,
      periodMinutes: publishedLookup.conditions.periodMinutes,
      provenance: publishedLookup.provenance,
    }),
  );
});

test("artifact bounds reject physically invalid duty-cycle values", () => {
  assert.equal(
    dutyCycleArtifactSchema.safeParse({
      type: "duty_cycle",
      process: "MIG",
      inputVoltage: 240,
      amperage: 200,
      dutyCyclePct: 101,
      periodMinutes: 10,
      provenance: { tier: 1, source: "test" },
    }).success,
    false,
  );
});

test("only a successful duty-cycle lookup yields a card", () => {
  // Another published spec is still a valid lookup; it just has no card to render.
  assert.equal(buildDutyCycleArtifact(resolveSpecQuery({ spec: "maximum_ocv" })), null);
  // An unpublished operating point must not be drawn as though it were measured.
  assert.equal(
    buildDutyCycleArtifact(
      resolveSpecQuery({ spec: "duty_cycle", process: "MIG", inputVoltage: 240, amperage: 9_999 }),
    ),
    null,
  );
});

test("SDK success envelopes with is_error=true never become done events", () => {
  const event = resultToEvent({
    type: "result",
    subtype: "success",
    is_error: true,
    result: "authentication failed",
  } as SDKResultMessage);

  assert.deepEqual(event, { type: "error", message: "authentication failed" });
});

test("done is emitted only for an error-free SDK result", () => {
  const event = resultToEvent({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 4,
    },
    total_cost_usd: 0.01,
  } as SDKResultMessage);

  assert.deepEqual(event, {
    type: "done",
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 4 },
    costUsd: 0.01,
  });
});

test("verified response cache normalizes keys and expires completed answers", () => {
  assert.equal(
    responseCacheKey("  MIG   DUTY cycle ", "rev"),
    responseCacheKey("mig duty CYCLE", "rev"),
  );
  const cache = new VerifiedResponseCache(2, 100);
  cache.set("one", [{ type: "text_delta", text: "verified" }], 1_000);
  assert.deepEqual(cache.get("one", 1_050), [{ type: "text_delta", text: "verified" }]);
  assert.equal(cache.get("one", 1_100), undefined);
  cache.set("empty", [], 1_000);
  assert.equal(cache.get("empty", 1_001), undefined);
});

test("sources are appended only when the question asks for them", () => {
  for (const question of [
    "What page says the duty cycle is 20%?",
    "Cite the manual for that",
    "Where does that number come from?",
    "Can you give me sources?",
    "Which section covers TIG polarity?",
    "According to what, exactly?",
    "Back that up for me",
    "Show me the page",
  ]) {
    assert.equal(asksForSources(question), true, question);
  }

  // "Power source" is the machine, not a citation — the commonest false positive here.
  for (const question of [
    "What's the duty cycle for MIG at 200A on 240V?",
    "Is this power source rated for 120 V?",
    "What's the source of the porosity in my flux-cored welds?",
    "Which welding source should I use for 1/8 inch mild steel?",
    "How do I load a 10 lb spool?",
  ]) {
    assert.equal(asksForSources(question), false, question);
  }
});

/** Rewrite one validated cable step so the fail-closed guards can be exercised against a
 *  record that is otherwise exactly what getSetup produced. */
function withCableStep(
  base: SetupResult,
  component: string,
  patch: { instruction?: string; state?: "required" | "optional" | "disconnected" },
): SetupResult {
  if (!base.found) throw new Error("expected a documented setup result");
  return {
    ...base,
    steps: base.steps.map((step) =>
      "component" in step && step.component === component ? { ...step, ...patch } : step,
    ),
  };
}

test("polarity_map derives DCEP/DCEN from validated get_setup connections only", () => {
  const mig = buildPolarityMapArtifact(getSetup({ process: "MIG", stage: "cables" }));
  assert.ok(mig);
  const parsed = polarityMapArtifactSchema.parse(mig);
  assert.equal(parsed.polarity?.label, "DCEP");
  assert.equal(parsed.polarity?.electrodeTerminal, "positive");
  assert.equal(parsed.polarity?.workTerminal, "negative");

  const ground = parsed.connections.find((item) => item.component === "ground_clamp");
  const electrode = parsed.connections.find((item) => item.component === "wire_feed_power");
  assert.deepEqual(
    { endpoint: ground?.endpoint, role: ground?.role },
    { endpoint: "negative_terminal", role: "work" },
  );
  assert.deepEqual(
    { endpoint: electrode?.endpoint, role: electrode?.role },
    { endpoint: "positive_terminal", role: "electrode" },
  );
  // Instructions are copied verbatim from the manual record, never re-phrased.
  assert.equal(electrode?.instruction, "Connect wire-feed power to the positive terminal.");
  assert.equal(dutyCycleArtifactSchema.safeParse(mig).success, false);
});

test("polarity_map keeps flux-cored on the opposite terminals from MIG", () => {
  const flux = buildPolarityMapArtifact(getSetup({ process: "flux_cored", stage: "cables" }));
  assert.ok(flux);
  assert.equal(flux.polarity?.label, "DCEN");
  assert.equal(flux.polarity?.electrodeTerminal, "negative");
  assert.equal(
    flux.connections.find((item) => item.component === "ground_clamp")?.endpoint,
    "positive_terminal",
  );
});

test("polarity_map preserves optional and deliberately disconnected TIG leads", () => {
  const tig = buildPolarityMapArtifact(getSetup({ process: "TIG", stage: "cables" }));
  assert.ok(tig);
  assert.equal(tig.polarity?.label, "DCEN");
  assert.equal(
    tig.connections.find((item) => item.component === "tig_torch")?.role,
    "electrode",
  );
  const pedal = tig.connections.find((item) => item.component === "foot_pedal");
  assert.deepEqual(
    { state: pedal?.state, endpoint: pedal?.endpoint, role: pedal?.role },
    { state: "optional", endpoint: "internal_connection", role: "auxiliary" },
  );
  const feed = tig.connections.find((item) => item.component === "wire_feed_power");
  assert.deepEqual(
    { state: feed?.state, endpoint: feed?.endpoint },
    { state: "disconnected", endpoint: "unconnected" },
  );
  // A disconnected lead must never be counted as the electrode side of the circuit.
  assert.equal(
    buildPolarityMapArtifact(getSetup({ process: "stick", stage: "cables" }))?.polarity?.label,
    "DCEP",
  );
});

test("polarity_map separates tier-1 terminals from the tier-3 polarity name", () => {
  const stick = buildPolarityMapArtifact(getSetup({ process: "stick", stage: "cables" }));
  assert.ok(stick);
  assert.ok(stick.connections.every((item) => item.provenance.tier === 1));
  assert.equal(stick.polarity?.provenance.tier, 3);
  assert.match(
    stick.polarity?.provenance.tier === 3 ? stick.polarity.provenance.basis : "",
    /positive terminal/,
  );
});

test("polarity_map is withheld when an instruction is unreadable or ambiguous", () => {
  const base = getSetup({ process: "MIG", stage: "cables" });
  assert.equal(
    buildPolarityMapArtifact(
      withCableStep(base, "ground_clamp", { instruction: "Connect the ground clamp to the lug." }),
    ),
    null,
  );
  assert.equal(
    buildPolarityMapArtifact(
      withCableStep(base, "ground_clamp", {
        instruction: "Connect the ground clamp to the negative terminal inside the welder.",
      }),
    ),
    null,
  );
});

test("polarity_map is withheld when a lead state contradicts its endpoint", () => {
  const tig = getSetup({ process: "TIG", stage: "cables" });
  assert.equal(
    buildPolarityMapArtifact(withCableStep(tig, "wire_feed_power", { state: "required" })),
    null,
  );
});

test("polarity_map is withheld when crossed cables contradict the published polarity fact", () => {
  const crossed = withCableStep(
    withCableStep(getSetup({ process: "MIG", stage: "cables" }), "ground_clamp", {
      instruction: "Connect the ground clamp to the positive terminal.",
    }),
    "wire_feed_power",
    { instruction: "Connect wire-feed power to the negative terminal." },
  );
  assert.equal(buildPolarityMapArtifact(crossed), null);
});

test("polarity_map is withheld for results without a cable stage", () => {
  assert.equal(buildPolarityMapArtifact(getSetup({ process: "MIG", stage: "consumables" })), null);
  assert.equal(buildPolarityMapArtifact(getSetup({ stage: "cables" })), null);
});

test("a polarity setup question is satisfiable by the evidence one get_setup call produces", () => {
  const question = "What's the polarity setup for flux-cored?";
  // The phrase trips three independent intents at once, so the validator demands all three.
  assert.equal(requiresSetup(question), true);
  assert.equal(requiresSourcePage(question), true);
  const intent = structuredSpecIntent(question);
  assert.equal(intent?.spec, "polarity");
  assert.equal(intent?.process, "flux_cored");

  const setup = getSetup({ process: "flux_cored", stage: "cables" });
  assert.equal(setup.found, true);
  if (!setup.found || !setup.visualSource) throw new Error("expected a reviewed cable source");

  // get_setup evidence alone is rejected; this is what failed twice in a row before.
  assert.match(
    validateResearchEvidence(question, [{ id: "e1", tool: "get_setup", result: setup }]) ?? "",
    /get_source_page was not called/,
  );

  // The host derives the other two from the same validated record, without a model turn.
  const sourceQuery = {
    kind: "document_page" as const,
    source: setup.visualSource.file,
    page: setup.visualSource.page,
    view: "detail" as const,
  };
  const evidence: EvidenceRecord[] = [
    { id: "e1", tool: "get_setup", result: setup },
    { id: "e2", tool: "lookup_spec", result: resolveSpecQuery({ spec: "polarity", process: "flux_cored" }) },
    { id: "e3", tool: "get_source_page", result: getSourcePage(sourceQuery) },
  ];
  assert.equal(validateResearchEvidence(question, evidence), null);
});

test("troubleshooting_flow generates Mermaid from the graph, not from the model", () => {
  const diagnosis = diagnoseProblem({ symptom: "wire feed motor runs but wire does not feed" });
  assert.equal(diagnosis.found, true);
  if (!diagnosis.found) return;

  const flow = buildTroubleshootingFlowArtifact(diagnosis);
  assert.ok(flow);
  const parsed = troubleshootingFlowArtifactSchema.parse(flow);

  assert.equal(parsed.problem, diagnosis.problem);
  assert.equal(parsed.stopCondition, diagnosis.stopCondition);
  assert.equal(parsed.recordId, diagnosis.recordId);
  assert.equal(parsed.branches.length, diagnosis.checks.length);
  // Every branch is copied from the graph verbatim — no summarising, no re-wording.
  assert.deepEqual(
    parsed.branches.map((branch) => [branch.cause, branch.check, branch.remedy, branch.repairScope]),
    diagnosis.checks.map((check) => [check.cause, check.check, check.remedy, check.repair_scope]),
  );

  assert.equal(parsed.mermaidStages.length, parsed.branches.length + 1);
  for (const [stageIndex, source] of parsed.mermaidStages.entries()) {
    assert.match(source, /^flowchart TD\n/);
    assert.ok(source.split("\n").length <= 30);
    assert.ok(source.length < 4_000);
    assert.equal(source.includes("Fixed"), false);
    assert.equal(source.includes("Not fixed"), false);
    for (const [branchIndex, branch] of parsed.branches.entries()) {
      const shouldBeVisible = stageIndex === parsed.branches.length || branchIndex <= stageIndex;
      assert.equal(
        new RegExp(`^  ${branch.key}\\[`, "m").test(source),
        shouldBeVisible,
        `${branch.key} visibility at stage ${stageIndex}`,
      );
      assert.equal(source.includes(branch.remedy), false);
    }
    assert.equal(source.includes('exhausted["Checks exhausted"]'), stageIndex === parsed.branches.length);
  }

  // Without an actionable prerequisite there is no safety node, and the causes hang
  // directly off the symptom rather than off a dangling edge.
  const generic = buildTroubleshootingFlowArtifact(
    diagnoseProblem({ symptom: "wire feeds but no arc", process: "MIG" }),
  );
  assert.ok(generic);
  assert.equal(generic.stopCondition, undefined);
  assert.equal(generic.mermaidStages.some((source) => source.includes("safety")), false);
});

test("troubleshooting_flow escapes label text that would break the Mermaid parse", () => {
  const flow = buildTroubleshootingFlowArtifact(
    diagnoseProblem({ symptom: "wire feed motor runs but wire does not feed" }),
  );
  assert.ok(flow);
  // Quotes terminate a Mermaid label and newlines terminate the statement; neither may
  // survive raw, and no line may be left dangling.
  const sources = flow.mermaidStages;
  for (const source of sources) {
    for (const line of source.split("\n")) {
      assert.equal((line.match(/"/g) ?? []).length % 2, 0, `unbalanced quotes: ${line}`);
    }
    assert.equal(source.includes("\r"), false);
  }
});

test("troubleshooting_flow is withheld for unknown and ambiguous symptoms", () => {
  assert.equal(
    buildTroubleshootingFlowArtifact(diagnoseProblem({ symptom: "the flux capacitor rattles" })),
    null,
  );
  const ambiguous = diagnoseProblem({ symptom: "weld" });
  assert.equal(ambiguous.found, false);
  assert.equal(buildTroubleshootingFlowArtifact(ambiguous), null);
});

test("every generated flow is accepted by the real Mermaid parser", async () => {
  // Mermaid is ESM-only and this suite compiles to CommonJS, so the import has to survive
  // TypeScript's downlevelling. jsdom stands in for the browser DOMPurify needs.
  const { JSDOM } = await new Function("return import('jsdom')")();
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  for (const key of ["window", "document", "Element", "SVGElement", "Node", "DOMParser", "HTMLElement"]) {
    try {
      (globalThis as Record<string, unknown>)[key] =
        key === "window" ? dom.window : dom.window[key];
    } catch {
      // navigator and friends are getter-only on newer Node; mermaid does not need them.
    }
  }

  const mermaid = (await new Function("return import('mermaid')")()).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

  const symptoms = [
    "wire feeds but no arc",
    "wire stops during welding",
    "the wire forms a bird nest in the feeder",
    "lcd display dark",
    "porosity in the weld",
    "arc is unstable with tig",
  ];

  let checked = 0;
  for (const symptom of symptoms) {
    const flow = buildTroubleshootingFlowArtifact(diagnoseProblem({ symptom }));
    assert.ok(flow, `expected a documented flow for "${symptom}"`);
    // Throws on any syntax our escaping failed to handle — an unescaped quote in a remedy
    // would take the whole diagram down at render time otherwise.
    const sources = flow.mermaidStages;
    for (const source of sources) {
      await mermaid.parse(source);
      checked += 1;
    }
  }
  assert.ok(checked > symptoms.length);
});
