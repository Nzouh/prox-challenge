import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {

  type Artifact,
} from "./artifacts";
import type { AgentEvent, AgentUsage } from "./events";
import {
  dedupeEvidence,
  stableJson,
  summarizeEvidence,
  toolCallKey,
} from "./evidence-summary";
import type { AgentInput } from "./input";
import { manualSearchQuerySchema, searchManual } from "./manual-search";
import {
  checkerOutputSchema,
  defaultCheckerOutput,
  renderWriterOutput,
  requiresRiskAssessment,
  routeQuestion,
  structuredSpecIntent,
  validateCheckerOutput,
  validateResearchEvidence,
  validateWriterOutput,
  writerOutputSchema,
  type CheckerOutput,
  type EvidenceRecord,
  type WriterOutput,
} from "./orchestration";
import { assessJobRisk, jobRiskQuerySchema } from "./safety";
import {
  buildDutyCycleArtifact,
  renderDeterministicSpecAnswer,
  resolveSpecQuery,
  type SpecQuery,
  type SpecResult,
} from "./specs";
import { buildPolarityMapArtifact } from "./polarity-map";
import { buildSetupChecklistArtifact, getSetup, setupQuerySchema } from "./setups";
import { diagnoseProblem, diagnosisQuerySchema } from "./diagnosis";
import { buildTroubleshootingFlowArtifact } from "./troubleshooting-flow";
import { faultIndicatorQuerySchema, lookupFaultIndicator } from "./fault-indicators";
import { assessPowerSource, powerSourceQuerySchema } from "./power-source";
import { checkRepairScope, repairScopeQuerySchema } from "./repair-scope";
import { buildSourceVisualArtifact, getSourcePage, sourcePageQuerySchema } from "./source-page";
import {
  processRecommendationQuerySchema,
  recommendProcess,
} from "./process-recommendation";
import { researchSessionOptions } from "./session";
import { SYSTEM_PROMPT } from "./system-prompt";
import {
  ALLOWED_TOOLS,
  ASSESS_JOB_RISK_TOOL,
  ASSESS_POWER_SOURCE_TOOL,
  CHECK_REPAIR_SCOPE_TOOL,
  DIAGNOSE_PROBLEM_TOOL,
  GET_SETUP_TOOL,
  GET_SOURCE_PAGE_TOOL,
  LOOKUP_SPEC_TOOL,
  LOOKUP_FAULT_INDICATOR_TOOL,
  MCP_SERVER_NAME,
  RECOMMEND_PROCESS_TOOL,
  SEARCH_MANUAL_TOOL,
  vulcanServer,
} from "./tools";
import { specQuerySchema } from "./tools/lookup-spec";

const RESEARCH_MODEL = "claude-opus-5";
const RESEARCH_FALLBACK_MODEL = "claude-sonnet-5";
const STRUCTURED_MODEL = "claude-haiku-4-5";
const STRUCTURED_FALLBACK_MODEL = "claude-sonnet-5";
const MAX_RESEARCH_ATTEMPTS = 2;
const MAX_WRITER_ATTEMPTS = 2;

type Totals = AgentUsage & { costUsd: number };

function addResultUsage(totals: Totals, result: SDKResultMessage): void {
  totals.inputTokens += result.usage.input_tokens;
  totals.outputTokens += result.usage.output_tokens;
  totals.cacheReadTokens += result.usage.cache_read_input_tokens ?? 0;
  totals.costUsd += result.total_cost_usd;
}

function resultError(result: SDKResultMessage): string | null {
  if (result.subtype !== "success") {
    return result.errors.join("; ") || `Agent stage failed: ${result.subtype}`;
  }
  return result.is_error ? result.result || "Agent stage returned an error result." : null;
}

async function runStructuredStage<T>(args: {
  role: "safety checker" | "writer";
  prompt: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  abortController: AbortController;
  maxBudgetUsd: number;
}): Promise<{ output: T; result: SDKResultMessage }> {
  const stream = query({
    prompt: args.prompt,
    options: {
      abortController: args.abortController,
      model: STRUCTURED_MODEL,
      fallbackModel: STRUCTURED_FALLBACK_MODEL,
      systemPrompt: args.systemPrompt,
      tools: [],
      allowedTools: [],
      settingSources: [],
      persistSession: false,
      // Structured-output completion can require one model turn plus the SDK's
      // schema-finalization turn. A limit of 1 intermittently returned max-turns.
      maxTurns: 2,
      maxBudgetUsd: args.maxBudgetUsd,
      outputFormat: {
        type: "json_schema",
        // The bundled Claude CLI currently validates Draft-07, not Zod's
        // default 2020-12 dialect.
        schema: z.toJSONSchema(args.schema, { target: "draft-07" }),
      },
    },
  });
  try {
    for await (const message of stream) {
      if (message.type !== "result") continue;
      const failure = resultError(message);
      if (failure) throw new Error(`${args.role} failed: ${failure}`);
      if (message.subtype !== "success") throw new Error(`${args.role} did not complete.`);
      return { output: args.schema.parse(message.structured_output), result: message };
    }
    throw new Error(`${args.role} ended without a result.`);
  } finally {
    stream.close();
  }
}

function checkerPrompt(question: string, evidence: readonly EvidenceRecord[]): string {
  return `Question:\n${question}\n\nVerified MCP evidence:\n${JSON.stringify(evidence, null, 2)}\n\nBuild a concise response plan. "approved" means the proposed response is evidence-grounded and safe; it never means approving the user's requested action. Approve a refusal/stop plan when the evidence supports refusing an unsafe request. Preserve the deterministic assess_job_risk disposition exactly. Every planned statement must cite one or more evidence IDs. Reject only when the evidence is insufficient to produce either safe guidance or a grounded refusal. Lead with Stop or Do not when disposition is stop.`;
}

function writerPrompt(
  question: string,
  evidence: readonly EvidenceRecord[],
  checker: CheckerOutput,
  feedback?: string,
): string {
  const allowedEvidenceIds = evidence.map((item) => item.id);
  return `Question:\n${question}\n\nVerified MCP evidence:\n${JSON.stringify(evidence, null, 2)}\n\nAllowed evidence IDs:\n${JSON.stringify(allowedEvidenceIds)}\n\nApproved checker plan:\n${JSON.stringify(checker, null, 2)}\n\nWrite the final answer as short paragraphs. Each paragraph must list only the smallest exact set of evidence IDs that supports it, and every ID must come from the allowed evidence IDs above. Answer only what was asked; do not offer an unrelated next step or setting. Express every measured quantity with digits so the host can validate it. Do not introduce any number, machine fact, repair step, or safety claim absent from the evidence and approved plan. Do not print citations; the host adds them. ${feedback ? `Previous deterministic-check failure: ${feedback}` : ""}`;
}

const CHECKER_SYSTEM_PROMPT = `You are the safety and grounding checker for a welding-support system. You cannot call tools. The approved field approves the safety and grounding of the response plan, not the action requested by the user. A clear refusal is an approved response when evidence supports it. Approve only claims supported by successful MCP evidence. Never weaken a deterministic safety disposition. Unknown context is not safe context. Produce only the required structured output.`;

const WRITER_SYSTEM_PROMPT = `You are the final writer for a welding-support system. You cannot call tools or add facts. Write only from the verified MCP evidence and approved checker plan. Answer only what the user asked, without unsolicited settings or offers. Write measured quantities with digits. Be direct, calm, and concise. When the disposition is stop, the first words must be Stop or Do not. Produce only the required structured output.`;

function matchingExactSpecEvidence(
  intent: SpecQuery,
  evidence: readonly EvidenceRecord[],
): EvidenceRecord | undefined {
  const expected = JSON.stringify(resolveSpecQuery(intent));
  return evidence.find(
    (item) => item.tool === "lookup_spec" && JSON.stringify(item.result) === expected,
  );
}

/**
 * Evidence agent -> deterministic validation/retry -> parallel checker + first writer ->
 * deterministic final checker. No successful done event can bypass the last checker.
 */
export async function* runValidatedAgent(
  input: AgentInput,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    yield {
      type: "error",
      message: "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.",
    };
    return;
  }

  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (signal?.aborted) return;
  signal?.addEventListener("abort", abort, { once: true });

  const totals: Totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  let announcedSession = false;
  let evidence: EvidenceRecord[] = [];
  let artifacts: Artifact[] = [];
  let checker: CheckerOutput | undefined;
  let writerOutput: WriterOutput | undefined;
  let writerAttempts = 0;
  let writerFeedback = "";
  let feedback = "";
  let researchSessionId = sessionId;
  let recoveredFromDeadSession = false;
  const successfulToolCalls = new Set<string>();
  const successfulEvidenceByCall = new Map<string, EvidenceRecord[]>();
  const successfulArtifactsByCall = new Map<string, Artifact[]>();
  const questionRoute = routeQuestion(input.text);
  const fastSpecIntent =
    questionRoute.kind === "needs_tool" && !requiresRiskAssessment(input.text)
      ? structuredSpecIntent(input.text)
      : null;

  try {
    for (let attempt = 1; attempt <= MAX_RESEARCH_ATTEMPTS; attempt += 1) {
      yield {
        type: "status",
        stage: "research",
        message: attempt === 1 ? "Checking the validated manual…" : "Rechecking the evidence…",
      };
      let attemptEvidence: EvidenceRecord[] = [...successfulEvidenceByCall.values()].flat();
      const pendingEvidence = new Map<string, EvidenceRecord[]>();
      const pendingArtifacts = new Map<string, Artifact[]>();
      const callKeyByToolUseId = new Map<string, string>();
      const attemptArtifacts: Artifact[] = [...successfulArtifactsByCall.values()]
        .flat()
        .filter(
          (artifact, index, all) =>
            all.findIndex((candidate) => stableJson(candidate) === stableJson(artifact)) === index,
        );
      let attemptFailure: string | null = null;
      let terminalResult: SDKResultMessage | undefined;
      const researchPrompt =
        attempt === 1
          ? input.text
          : `${input.text}\n\nValidation feedback from the previous attempt: ${feedback}\nPreviously successful deterministic calls:\n${JSON.stringify([...successfulToolCalls], null, 2)}\nCall only missing or corrected MCP tools. Do not repeat an identical successful call, and do not rely on memory.`;
      // Exact, fully specified, low-risk lookups need only a fast MCP-routing turn. If
      // that turn fails host validation, the bounded retry automatically uses Opus.
      const useFastResearchModel = fastSpecIntent !== null && attempt === 1;
      const stream = query({
        prompt: researchPrompt,
        options: {
          abortController,
          model: useFastResearchModel ? STRUCTURED_MODEL : RESEARCH_MODEL,
          fallbackModel: useFastResearchModel
            ? STRUCTURED_FALLBACK_MODEL
            : RESEARCH_FALLBACK_MODEL,
          systemPrompt: SYSTEM_PROMPT,
          ...researchSessionOptions(researchSessionId),
          mcpServers: {
            // Every artifact is derived host-side from its evidence tool, so the tool set
            // is the same on every request. That keeps one cached prefix rather than one
            // per visual-request variant (tools render ahead of the system prompt).
            [MCP_SERVER_NAME]: vulcanServer,
          },
          allowedTools: ALLOWED_TOOLS,
          tools: [],
          settingSources: [],
          strictMcpConfig: true,
          includePartialMessages: false,
          maxTurns: useFastResearchModel ? 4 : 8,
          maxBudgetUsd: useFastResearchModel ? 0.08 : 0.35,
        },
      });

      try {
        for await (const message of stream) {
          if ("session_id" in message && message.session_id) {
            researchSessionId = message.session_id;
            if (!announcedSession) {
              announcedSession = true;
              yield { type: "session", sessionId: message.session_id };
            }
          }
          if (message.type === "assistant") {
            if (message.error) attemptFailure = `Model request failed: ${message.error}`;
            for (const block of message.message.content) {
              if (block.type !== "tool_use") continue;
              callKeyByToolUseId.set(block.id, toolCallKey(block.name, block.input));
              yield { type: "tool_start", id: block.id, name: block.name, input: block.input };
              const addAttemptArtifact = (artifact: Artifact | null | undefined) => {
                if (!artifact) return;
                if (!attemptArtifacts.some((candidate) => stableJson(candidate) === stableJson(artifact))) {
                  attemptArtifacts.push(artifact);
                }
                pendingArtifacts.set(block.id, [...(pendingArtifacts.get(block.id) ?? []), artifact]);
              };

              if (block.name === LOOKUP_SPEC_TOOL) {
                const parsed = specQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  const result = resolveSpecQuery(parsed.data);
                  pendingEvidence.set(block.id, [
                    { id: `evidence:${block.id}`, tool: "lookup_spec", result },
                  ]);
                  addAttemptArtifact(buildDutyCycleArtifact(result));
                } else {
                  attemptFailure = `lookup_spec input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === GET_SETUP_TOOL) {
                const parsed = setupQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  const setupResult = getSetup(parsed.data);
                  // A phrase like "polarity setup" trips the setup, source-page, and
                  // structured-spec intents at once, and the validator requires all three.
                  // The host already holds every input those lookups need, so it runs them
                  // itself rather than spending research attempts hoping the model calls
                  // each one. They are the same deterministic functions the MCP tools call.
                  const setupEvidence: EvidenceRecord[] = [
                    { id: `evidence:${block.id}`, tool: "get_setup", result: setupResult },
                  ];
                  const specIntent = structuredSpecIntent(input.text);
                  if (
                    setupResult.found &&
                    specIntent?.spec === "polarity" &&
                    specIntent.process === setupResult.process
                  ) {
                    setupEvidence.push({
                      id: `evidence:${block.id}:polarity`,
                      tool: "lookup_spec",
                      result: resolveSpecQuery(specIntent),
                    });
                  }
                  pendingEvidence.set(block.id, setupEvidence);
                  const polarityMap = buildPolarityMapArtifact(setupResult);
                  addAttemptArtifact(polarityMap);
                  // A cables-only checklist would repeat the map's own list verbatim, so
                  // the map supersedes it; wider stages still need the full checklist.
                  const checklist =
                    polarityMap && setupResult.found && setupResult.setup === "cables"
                      ? null
                      : buildSetupChecklistArtifact(setupResult);
                  addAttemptArtifact(checklist);
                  if (setupResult.found && setupResult.visualSource) {
                    const sourceQuery = {
                      kind: "document_page" as const,
                      source: setupResult.visualSource.file,
                      page: setupResult.visualSource.page,
                      view: "detail" as const,
                    };
                    const sourceResult = getSourcePage(sourceQuery);
                    const visual = buildSourceVisualArtifact(sourceQuery, sourceResult);
                    if (visual) {
                      addAttemptArtifact(visual);
                      setupEvidence.push({
                        id: `evidence:${block.id}:source`,
                        tool: "get_source_page",
                        result: sourceResult,
                      });
                    }
                  }
                } else {
                  attemptFailure = `get_setup input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === DIAGNOSE_PROBLEM_TOOL) {
                const parsed = diagnosisQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  const diagnosisResult = diagnoseProblem(parsed.data);
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "diagnose_problem",
                      result: diagnosisResult,
                    },
                  ]);

                  const flow = buildTroubleshootingFlowArtifact(diagnosisResult);
                  addAttemptArtifact(flow);
                } else {
                  attemptFailure = `diagnose_problem input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === LOOKUP_FAULT_INDICATOR_TOOL) {
                const parsed = faultIndicatorQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "lookup_fault_indicator",
                      result: lookupFaultIndicator(parsed.data),
                    },
                  ]);
                } else {
                  attemptFailure = `lookup_fault_indicator input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === RECOMMEND_PROCESS_TOOL) {
                const parsed = processRecommendationQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "recommend_process",
                      result: recommendProcess(parsed.data),
                    },
                  ]);
                } else {
                  attemptFailure = `recommend_process input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === SEARCH_MANUAL_TOOL) {
                const parsed = manualSearchQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  const result = searchManual(parsed.data);
                  pendingEvidence.set(
                    block.id,
                    result.found
                      ? result.hits.map((hit, index) => ({
                          id: `evidence:${block.id}:hit:${index + 1}`,
                          tool: "search_manual" as const,
                          result: { ...result, hits: [hit] },
                        }))
                      : [{ id: `evidence:${block.id}`, tool: "search_manual", result }],
                  );
                } else {
                  attemptFailure = `search_manual input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === ASSESS_JOB_RISK_TOOL) {
                const parsed = jobRiskQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "assess_job_risk",
                      result: assessJobRisk(parsed.data),
                    },
                  ]);
                } else {
                  attemptFailure = `assess_job_risk input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === ASSESS_POWER_SOURCE_TOOL) {
                const parsed = powerSourceQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "assess_power_source",
                      result: assessPowerSource(parsed.data),
                    },
                  ]);
                } else {
                  attemptFailure = `assess_power_source input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === CHECK_REPAIR_SCOPE_TOOL) {
                const parsed = repairScopeQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "check_repair_scope",
                      result: checkRepairScope(parsed.data),
                    },
                  ]);
                } else {
                  attemptFailure = `check_repair_scope input failed host validation: ${parsed.error.message}`;
                }
              } else if (block.name === GET_SOURCE_PAGE_TOOL) {
                const parsed = sourcePageQuerySchema.safeParse(block.input);
                if (parsed.success) {
                  const sourceResult = getSourcePage(parsed.data);
                  pendingEvidence.set(block.id, [
                    {
                      id: `evidence:${block.id}`,
                      tool: "get_source_page",
                      result: sourceResult,
                    },
                  ]);
                  const visual = buildSourceVisualArtifact(parsed.data, sourceResult);
                  addAttemptArtifact(visual);
                } else {
                  attemptFailure = `get_source_page input failed host validation: ${parsed.error.message}`;
                }
              }
            }
          } else if (message.type === "user") {
            const content = message.message.content;
            if (typeof content === "string") continue;
            for (const block of content) {
              if (block.type !== "tool_result") continue;
              const ok = block.is_error !== true;
              yield { type: "tool_end", id: block.tool_use_id, ok };
              const pending = pendingEvidence.get(block.tool_use_id);
              pendingEvidence.delete(block.tool_use_id);
              if (ok && pending) attemptEvidence.push(...pending);
              const callKey = callKeyByToolUseId.get(block.tool_use_id);
              callKeyByToolUseId.delete(block.tool_use_id);
              const artifactsForCall = pendingArtifacts.get(block.tool_use_id);
              pendingArtifacts.delete(block.tool_use_id);
              if (ok && callKey) {
                successfulToolCalls.add(callKey);
                if (pending) successfulEvidenceByCall.set(callKey, pending);
                if (artifactsForCall) successfulArtifactsByCall.set(callKey, artifactsForCall);
              }
              if (!ok) attemptFailure = "An MCP tool call failed.";
            }
          } else if (message.type === "result") {
            terminalResult = message;
          }
        }
      } catch (error) {
        // A resumed session id can outlive the transcript it points at — a worker restart,
        // or a browser whose stored history outlasted the server's. The SDK throws instead
        // of returning a result, so this is the only place that failure is visible. Drop
        // the dead handle and replay the same attempt on a fresh session: the question is
        // still answerable, only the earlier turns of context are lost.
        //
        // The dead id was already announced, so clear that too — otherwise the client
        // keeps storing a handle that resolves to nothing on every future turn.
        if (abortController.signal.aborted || !researchSessionId || recoveredFromDeadSession) {
          throw error;
        }
        recoveredFromDeadSession = true;
        researchSessionId = undefined;
        announcedSession = false;
        attempt -= 1;
        continue;
      } finally {
        stream.close();
      }

      if (!terminalResult) attemptFailure = attemptFailure ?? "Research agent ended without a result.";
      if (terminalResult) {
        addResultUsage(totals, terminalResult);
        attemptFailure = attemptFailure ?? resultError(terminalResult);
      }
      // SDK tool-use IDs are long and persist in the resumed research transcript.
      // Structured stages receive short IDs scoped only to this validated attempt.
      attemptEvidence = dedupeEvidence(attemptEvidence).map((item, index) => ({
        ...item,
        id: `e${index + 1}`,
      }));
      attemptFailure = attemptFailure ?? validateResearchEvidence(input.text, attemptEvidence);

      // A persisted fast-route session contains the research model's own final text even
      // though the UI receives the deterministic rendering below. Reject a numerically
      // inconsistent answer so incorrect context is not silently accepted into follow-ups.
      if (
        !attemptFailure &&
        useFastResearchModel &&
        terminalResult?.subtype === "success" &&
        fastSpecIntent
      ) {
        const exactSpecEvidence = matchingExactSpecEvidence(fastSpecIntent, attemptEvidence);
        if (exactSpecEvidence) {
          const fastChecker = defaultCheckerOutput([exactSpecEvidence]);
          attemptFailure = validateWriterOutput(
            {
              paragraphs: [
                {
                  text: terminalResult.result,
                  evidenceIds: [exactSpecEvidence.id],
                },
              ],
            },
            fastChecker,
            [exactSpecEvidence],
            input.text,
          );
        }
      }

      let attemptChecker: CheckerOutput | undefined;
      let attemptWriter: WriterOutput | undefined;
      let attemptWriterFailure = "";
      if (!attemptFailure) {
        const provisionalChecker = defaultCheckerOutput(attemptEvidence);
        const exactSpecEvidence = fastSpecIntent
          ? matchingExactSpecEvidence(fastSpecIntent, attemptEvidence)
          : undefined;
        const hasTroubleshootingFlow = attemptArtifacts.some(
          (artifact) => artifact.type === "troubleshooting_flow",
        );

        if (hasTroubleshootingFlow && !requiresRiskAssessment(input.text)) {
          // The interactive flow is a deterministic rendering of already validated
          // diagnosis evidence. A second prose writer would only duplicate it.
          const diagnosisEvidence = attemptEvidence.find(
            (item) => item.tool === "diagnose_problem",
          );
          attemptChecker = provisionalChecker;
          attemptWriter = {
            paragraphs: [
              {
                text: "Interactive troubleshooting flow.",
                evidenceIds: diagnosisEvidence ? [diagnosisEvidence.id] : [],
              },
            ],
          };
        } else if (exactSpecEvidence) {
          // The MCP result has already been recomputed and matched by the host. Rendering
          // that narrow result directly skips both redundant model verification stages.
          attemptChecker = provisionalChecker;
          attemptWriter = {
            paragraphs: [
              {
                text: renderDeterministicSpecAnswer(exactSpecEvidence.result as SpecResult),
                evidenceIds: [exactSpecEvidence.id],
              },
            ],
          };
          attemptFailure = validateWriterOutput(
            attemptWriter,
            attemptChecker,
            attemptEvidence,
            input.text,
          );
        } else {
          const needsSafetyChecker = requiresRiskAssessment(input.text);
          yield {
            type: "status",
            stage: needsSafetyChecker ? "verification" : "writing",
            message: needsSafetyChecker
              ? "Verifying safety while drafting the answer…"
              : "Writing the verified answer…",
          };
          const checkerTask = needsSafetyChecker
            ? runStructuredStage({
                role: "safety checker",
                prompt: checkerPrompt(input.text, attemptEvidence),
                schema: checkerOutputSchema,
                systemPrompt: CHECKER_SYSTEM_PROMPT,
                abortController,
                maxBudgetUsd: 0.12,
              })
            : Promise.resolve({ output: provisionalChecker, result: undefined });
          const writerTask = runStructuredStage({
            role: "writer",
            prompt: writerPrompt(input.text, attemptEvidence, provisionalChecker),
            schema: writerOutputSchema,
            systemPrompt: WRITER_SYSTEM_PROMPT,
            abortController,
            maxBudgetUsd: 0.15,
          });
          const [checked, written] = await Promise.all([checkerTask, writerTask]);
          if (checked.result) addResultUsage(totals, checked.result);
          addResultUsage(totals, written.result);
          attemptChecker = checked.output;
          attemptFailure = validateCheckerOutput(attemptChecker, attemptEvidence);
          if (!attemptFailure) {
            attemptWriterFailure =
              validateWriterOutput(written.output, attemptChecker, attemptEvidence, input.text) ?? "";
            if (!attemptWriterFailure) attemptWriter = written.output;
          }
        }
      }

      if (!attemptFailure && attemptChecker) {
        evidence = attemptEvidence;
        artifacts = attemptArtifacts;
        checker = attemptChecker;
        writerOutput = attemptWriter;
        writerAttempts = 1;
        writerFeedback = attemptWriterFailure;
        break;
      }
      feedback = attemptFailure ?? "Unknown evidence validation failure.";
    }

    if (!checker) {
      yield { type: "error", message: `Evidence validation failed after ${MAX_RESEARCH_ATTEMPTS} attempts: ${feedback}` };
      return;
    }

    while (!writerOutput && writerAttempts < MAX_WRITER_ATTEMPTS) {
      writerAttempts += 1;
      yield { type: "status", stage: "writing", message: "Refining the verified answer…" };
      const written = await runStructuredStage({
        role: "writer",
        prompt: writerPrompt(input.text, evidence, checker, writerFeedback || undefined),
        schema: writerOutputSchema,
        systemPrompt: WRITER_SYSTEM_PROMPT,
        abortController,
        maxBudgetUsd: 0.15,
      });
      addResultUsage(totals, written.result);
      const failure = validateWriterOutput(written.output, checker, evidence, input.text);
      if (!failure) {
        writerOutput = written.output;
        break;
      }
      writerFeedback = failure;
    }

    if (!writerOutput) {
      yield { type: "error", message: `Final writer validation failed: ${writerFeedback}` };
      return;
    }

    for (const item of evidence) yield { type: "evidence", evidence: summarizeEvidence(item) };
    for (const artifact of artifacts) yield { type: "artifact", artifact };
    if (!artifacts.some((artifact) => artifact.type === "troubleshooting_flow")) {
      yield { type: "text_delta", text: renderWriterOutput(writerOutput, evidence, input.text) };
    }
    yield {
      type: "done",
      usage: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
      },
      costUsd: totals.costUsd,
    };
  } catch (error) {
    if (!abortController.signal.aborted) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
