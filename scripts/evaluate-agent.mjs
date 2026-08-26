import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const baseUrl = argument("--base-url", "http://127.0.0.1:3100");
const questionsPath = resolve(argument("--questions", "evals/questions.json"));
const outputPath = resolve(argument("--output", "evals/results/latest.json"));
const reportPath = resolve(argument("--report", "evals/results/latest.md"));
const allQuestions = JSON.parse(readFileSync(questionsPath, "utf8"));
const expectedToolFilter = argument("--expected-tool", null);
const requestedIds = new Set(
  argument("--ids", "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const questions = requestedIds.size > 0
  ? allQuestions.filter((question) => requestedIds.has(question.id))
  : expectedToolFilter
    ? allQuestions.filter((question) => question.expectedTools?.includes(expectedToolFilter))
    : allQuestions;
if (questions.length === 0) {
  throw new Error(`No evaluation questions matched expected tool: ${expectedToolFilter}`);
}

function patternMatches(pattern, value) {
  return new RegExp(pattern, "is").test(value);
}

function shortToolName(name) {
  return name.replace(/^mcp__[^_]+__/, "");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function partiallyMatches(expected, actual) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    return (
      actual &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(expected).every(([key, value]) => partiallyMatches(value, actual[key]))
    );
  }
  return stableJson(expected) === stableJson(actual);
}

function score(question, run) {
  const checks = [];
  const warnings = [];
  const add = (name, passed, detail) => checks.push({ name, passed, detail });
  add("completed", run.done && !run.error, run.error || (run.done ? "done" : "missing done event"));
  for (const tool of question.expectedTools ?? []) {
    add(`tool:${tool}`, run.tools.includes(tool), `called: ${run.tools.join(", ") || "none"}`);
  }
  for (const tool of question.forbiddenTools ?? []) {
    add(
      `tool-forbidden:${tool}`,
      !run.tools.includes(tool),
      `called: ${run.tools.join(", ") || "none"}`,
    );
  }
  const additionalTools = [
    ...new Set(run.tools.filter((tool) => !(question.expectedTools ?? []).includes(tool))),
  ];
  if (additionalTools.length > 0) {
    warnings.push({
      name: "tools:additional",
      detail: `additional: ${additionalTools.join(", ")}`,
    });
  }
  for (const expected of question.expectedEvidence ?? []) {
    add(
      `evidence:${stableJson(expected)}`,
      run.evidence.some((actual) => partiallyMatches(expected, actual)),
      `observed: ${stableJson(run.evidence)}`,
    );
  }
  for (const artifact of question.expectedArtifacts ?? []) {
    add(
      `artifact:${artifact}`,
      run.artifactTypes.includes(artifact),
      `emitted: ${run.artifactTypes.join(", ") || "none"}`,
    );
  }
  for (const artifact of question.forbiddenArtifacts ?? []) {
    add(
      `artifact-forbidden:${artifact}`,
      !run.artifactTypes.includes(artifact),
      `emitted: ${run.artifactTypes.join(", ") || "none"}`,
    );
  }
  const artifactPayload = JSON.stringify(run.artifacts);
  for (const pattern of question.requiredArtifactPatterns ?? []) {
    add(`artifact-required:${pattern}`, patternMatches(pattern, artifactPayload), pattern);
  }
  for (const pattern of question.requiredPatterns ?? []) {
    add(`required:${pattern}`, patternMatches(pattern, run.answer), pattern);
  }
  for (const pattern of question.sourcePatterns ?? []) {
    add(`source:${pattern}`, patternMatches(pattern, run.answer), pattern);
  }
  for (const pattern of question.forbiddenPatterns ?? []) {
    add(`forbidden:${pattern}`, !patternMatches(pattern, run.answer), pattern);
  }
  if (question.answerStartPattern) {
    add(
      `start:${question.answerStartPattern}`,
      patternMatches(question.answerStartPattern, run.answer.trimStart()),
      run.answer.slice(0, 100),
    );
  }
  return { passed: checks.every((check) => check.passed), checks, warnings };
}

async function readEvents(response, startedAt) {
  if (!response.body) throw new Error("Response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
      if (line) events.push({ atMs: performance.now() - startedAt, event: JSON.parse(line.slice(6)) });
    }
  }
  return events;
}

async function ask(question) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { kind: "text", text: question } }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const stampedEvents = await readEvents(response, startedAt);
  const durationMs = performance.now() - startedAt;
  const answer = stampedEvents
    .filter(({ event }) => event.type === "text_delta")
    .map(({ event }) => event.text)
    .join("");
  const allToolCalls = stampedEvents
    .filter(({ event }) => event.type === "tool_start")
    .map(({ event }) => ({ name: shortToolName(event.name), input: event.input }));
  const seenToolCalls = new Set();
  const toolCalls = allToolCalls.filter((call) => {
    const key = `${call.name}:${stableJson(call.input)}`;
    if (seenToolCalls.has(key)) return false;
    seenToolCalls.add(key);
    return true;
  });
  const tools = toolCalls.map((call) => call.name);
  const evidence = stampedEvents
    .filter(({ event }) => event.type === "evidence")
    .map(({ event }) => event.evidence);
  const artifacts = stampedEvents
    .filter(({ event }) => event.type === "artifact")
    .map(({ event }) => event.artifact);
  const terminal = stampedEvents.findLast(({ event }) => event.type === "done")?.event;
  const error = stampedEvents.findLast(({ event }) => event.type === "error")?.event?.message;
  const firstEventMs = stampedEvents[0]?.atMs ?? null;
  const firstToolMs = stampedEvents.find(({ event }) => event.type === "tool_start")?.atMs ?? null;
  const firstAnswerMs = stampedEvents.find(({ event }) => event.type === "text_delta")?.atMs ?? null;
  const statuses = stampedEvents
    .filter(({ event }) => event.type === "status")
    .map(({ atMs, event }) => ({ atMs, stage: event.stage, message: event.message }));
  return {
    answer,
    tools,
    toolCalls,
    evidence,
    artifacts,
    artifactTypes: artifacts.map((artifact) => artifact.type),
    done: Boolean(terminal),
    cached: terminal?.cached === true,
    error: error ?? null,
    usage: terminal?.usage ?? null,
    costUsd: terminal?.costUsd ?? 0,
    durationMs,
    firstEventMs,
    firstToolMs,
    firstAnswerMs,
    statuses,
    events: stampedEvents,
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value, digits = 1) {
  return value == null ? null : Number(value.toFixed(digits));
}

function summarize(results, cacheProbe, startedAt, finishedAt) {
  const completed = results.filter((result) => result.run.done && !result.run.error);
  const durations = completed.map((result) => result.run.durationMs);
  const answerTimes = completed.map((result) => result.run.firstAnswerMs).filter((value) => value != null);
  const byCategory = Object.fromEntries(
    [...new Set(results.map((result) => result.category))].map((category) => {
      const rows = results.filter((result) => result.category === category);
      return [category, { passed: rows.filter((row) => row.score.passed).length, total: rows.length }];
    }),
  );
  const namedChecks = results.flatMap((result) => result.score.checks);
  const toolChecks = namedChecks.filter(
    (check) => check.name.startsWith("tool:") || check.name.startsWith("tool-forbidden:"),
  );
  const artifactChecks = namedChecks.filter((check) => check.name.startsWith("artifact:" ) || check.name.startsWith("artifact-forbidden:"));
  const toolWarnings = results.flatMap((result) => result.score.warnings);
  return {
    startedAt,
    finishedAt,
    questionCount: results.length,
    completed: completed.length,
    passed: results.filter((result) => result.score.passed).length,
    failed: results.filter((result) => !result.score.passed).length,
    byCategory,
    toolRouting: {
      passed: toolChecks.filter((check) => check.passed).length,
      total: toolChecks.length,
    },
    toolEfficiencyWarnings: toolWarnings.length,
    artifactRouting: {
      passed: artifactChecks.filter((check) => check.passed).length,
      total: artifactChecks.length,
    },
    latencyMs: {
      mean: round(durations.reduce((sum, value) => sum + value, 0) / Math.max(durations.length, 1)),
      p50: round(percentile(durations, 0.5)),
      p95: round(percentile(durations, 0.95)),
      firstAnswerP50: round(percentile(answerTimes, 0.5)),
      firstAnswerP95: round(percentile(answerTimes, 0.95)),
    },
    totalCostUsd: round(results.reduce((sum, result) => sum + result.run.costUsd, 0), 4),
    totalUsage: results.reduce(
      (total, result) => ({
        inputTokens: total.inputTokens + (result.run.usage?.inputTokens ?? 0),
        outputTokens: total.outputTokens + (result.run.usage?.outputTokens ?? 0),
        cacheReadTokens: total.cacheReadTokens + (result.run.usage?.cacheReadTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    ),
    cacheProbe: {
      durationMs: round(cacheProbe.durationMs),
      cached: cacheProbe.cached,
      costUsd: cacheProbe.costUsd,
    },
  };
}

function markdown(payload) {
  const { summary, results } = payload;
  const lines = [
    "# Agent benchmark",
    "",
    `- Run: ${summary.startedAt} -> ${summary.finishedAt}`,
    `- Accuracy: ${summary.passed}/${summary.questionCount} (${((summary.passed / summary.questionCount) * 100).toFixed(1)}%)`,
    `- Completed: ${summary.completed}/${summary.questionCount}`,
    `- Latency: p50 ${(summary.latencyMs.p50 / 1_000).toFixed(2)} s; p95 ${(summary.latencyMs.p95 / 1_000).toFixed(2)} s`,
    `- First answer: p50 ${(summary.latencyMs.firstAnswerP50 / 1_000).toFixed(2)} s; p95 ${(summary.latencyMs.firstAnswerP95 / 1_000).toFixed(2)} s`,
    `- Total API cost: $${summary.totalCostUsd.toFixed(4)}`,
    `- Cache probe: ${summary.cacheProbe.cached ? "hit" : "miss"} in ${(summary.cacheProbe.durationMs / 1_000).toFixed(3)} s`,
    `- Tool routing: ${summary.toolRouting.passed}/${summary.toolRouting.total}`,
    `- Additional-tool warnings: ${summary.toolEfficiencyWarnings}`,
    `- Artifact routing: ${summary.artifactRouting.passed}/${summary.artifactRouting.total}`,
    "",
    "## Categories",
    "",
    ...Object.entries(summary.byCategory).map(([category, value]) => `- ${category}: ${value.passed}/${value.total}`),
    "",
    "## Results",
    "",
    "| ID | Result | Latency | Cost | Tools | Artifacts |",
    "|---|---:|---:|---:|---|---|",
    ...results.map(
      (result) =>
        `| ${result.id} | ${result.score.passed ? "PASS" : "FAIL"} | ${(result.run.durationMs / 1_000).toFixed(2)} s | $${result.run.costUsd.toFixed(4)} | ${result.run.tools.join(", ") || "none"} | ${result.run.artifactTypes.join(", ") || "none"} |`,
    ),
    "",
    "## Failed checks",
    "",
  ];
  for (const result of results.filter((row) => !row.score.passed)) {
    lines.push(`### ${result.id}`, "");
    for (const check of result.score.checks.filter((item) => !item.passed)) {
      lines.push(`- ${check.name}: ${check.detail}`);
    }
    lines.push("", "Answer:", "", result.run.answer || `ERROR: ${result.run.error}`, "");
  }
  const warningRows = results.filter((row) => row.score.warnings.length > 0);
  if (warningRows.length > 0) {
    lines.push("## Tool-efficiency warnings", "");
    for (const result of warningRows) {
      for (const warning of result.score.warnings) {
        lines.push(`- ${result.id}: ${warning.detail}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

mkdirSync(dirname(outputPath), { recursive: true });
const suiteStartedAt = new Date().toISOString();
const results = [];
for (const [index, question] of questions.entries()) {
  let run;
  try {
    run = await ask(question.question);
  } catch (error) {
    run = {
      answer: "",
      tools: [],
      toolCalls: [],
      evidence: [],
      artifacts: [],
      artifactTypes: [],
      done: false,
      cached: false,
      error: error instanceof Error ? error.message : String(error),
      usage: null,
      costUsd: 0,
      durationMs: 0,
      firstEventMs: null,
      firstToolMs: null,
      firstAnswerMs: null,
      statuses: [],
      events: [],
    };
  }
  const result = { ...question, run, score: score(question, run) };
  results.push(result);
  const marker = result.score.passed ? "PASS" : "FAIL";
  process.stdout.write(
    `[${String(index + 1).padStart(2, "0")}/${questions.length}] ${marker} ${question.id} ${(run.durationMs / 1_000).toFixed(2)}s $${run.costUsd.toFixed(4)}\n`,
  );
  writeFileSync(outputPath, `${JSON.stringify({ partial: true, results }, null, 2)}\n`);
}

const cacheProbe = await ask(questions.at(-1).question);
const suiteFinishedAt = new Date().toISOString();
const summary = summarize(results, cacheProbe, suiteStartedAt, suiteFinishedAt);
const payload = { summary, results, cacheProbe };
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(reportPath, markdown(payload));
process.stdout.write(`SUMMARY ${summary.passed}/${summary.questionCount} $${summary.totalCostUsd.toFixed(4)} p50=${(summary.latencyMs.p50 / 1_000).toFixed(2)}s p95=${(summary.latencyMs.p95 / 1_000).toFixed(2)}s\n`);
