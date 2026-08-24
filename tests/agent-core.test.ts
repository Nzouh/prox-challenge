import assert from "node:assert/strict";
import test from "node:test";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { dutyCycleArtifactSchema } from "../lib/agent/artifacts";
import { artifactMatchesLookup } from "../lib/agent/grounding";
import { resultToEvent } from "../lib/agent/result";
import { resolveSpecQuery } from "../lib/agent/specs";
import { searchManual } from "../lib/agent/manual-search";
import { assessJobRisk } from "../lib/agent/safety";
import {
  defaultCheckerOutput,
  requiresRiskAssessment,
  validateResearchEvidence,
  validateWriterOutput,
  type EvidenceRecord,
} from "../lib/agent/orchestration";

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
