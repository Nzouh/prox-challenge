import assert from "node:assert/strict";
import test from "node:test";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { dutyCycleArtifactSchema, shouldOfferArtifacts } from "../lib/agent/artifacts";
import { artifactMatchesLookup } from "../lib/agent/grounding";
import { resultToEvent } from "../lib/agent/result";
import { responseCacheKey, VerifiedResponseCache } from "../lib/agent/response-cache";
import { renderDeterministicSpecAnswer, resolveSpecQuery } from "../lib/agent/specs";
import { searchManual } from "../lib/agent/manual-search";
import { assessJobRisk } from "../lib/agent/safety";
import { getSetup } from "../lib/agent/setups";
import { diagnoseProblem, diagnosticRecordCount } from "../lib/agent/diagnosis";
import { lookupFaultIndicator } from "../lib/agent/fault-indicators";
import { recommendProcess } from "../lib/agent/process-recommendation";
import { assessPowerSource } from "../lib/agent/power-source";
import { checkRepairScope } from "../lib/agent/repair-scope";
import { getSourcePage } from "../lib/agent/source-page";
import { researchSessionOptions } from "../lib/agent/session";
import {
  defaultCheckerOutput,
  requiresFaultIndicatorLookup,
  requiresProcessRecommendation,
  requiresPowerSourceAssessment,
  requiresRepairScopeCheck,
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

test("new tool intents require their matching evidence", () => {
  assert.equal(requiresPowerSourceAssessment("Can I run it from a battery bank?"), true);
  assert.equal(requiresRepairScopeCheck("Can I replace the internal PCB myself?"), true);
  assert.equal(requiresSourcePage("Show me the manual page for the front controls."), true);
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

test("an artifact must exactly match a successful lookup", () => {
  assert.equal(publishedLookup.found, true);
  assert.equal(publishedLookup.spec, "duty_cycle");
  if (!publishedLookup.found || publishedLookup.spec !== "duty_cycle") return;

  const grounded = dutyCycleArtifactSchema.parse({
    type: "duty_cycle",
    process: publishedLookup.conditions.process,
    inputVoltage: publishedLookup.conditions.inputVoltage,
    amperage: publishedLookup.conditions.amperage,
    dutyCyclePct: publishedLookup.value,
    periodMinutes: publishedLookup.conditions.periodMinutes,
    provenance: publishedLookup.provenance,
  });

  assert.equal(artifactMatchesLookup(grounded, publishedLookup), true);
  assert.equal(
    artifactMatchesLookup({ ...grounded, dutyCyclePct: 90 }, publishedLookup),
    false,
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

test("ordinary specification answers do not offer an artifact tool", () => {
  assert.equal(shouldOfferArtifacts("What's the duty cycle for MIG at 200A on 240V?"), false);
  assert.equal(shouldOfferArtifacts("Show that duty cycle as a visual timeline"), true);
  assert.equal(shouldOfferArtifacts("Draw a duty-cycle chart for me"), true);
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
