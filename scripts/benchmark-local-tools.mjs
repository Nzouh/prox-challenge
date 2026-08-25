import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const compiledRoot = resolve(".test-dist/lib/agent");

if (process.argv.includes("--cold-child")) {
  const started = performance.now();
  require(`${compiledRoot}/manual-search.js`);
  require(`${compiledRoot}/specs.js`);
  require(`${compiledRoot}/safety.js`);
  require(`${compiledRoot}/process-recommendation.js`);
  require(`${compiledRoot}/power-source.js`);
  require(`${compiledRoot}/repair-scope.js`);
  require(`${compiledRoot}/source-page.js`);
  require(`${compiledRoot}/orchestration.js`);
  process.stdout.write(JSON.stringify({ moduleLoadMs: performance.now() - started }));
  process.exit(0);
}

const outputPath = resolve("evals/results/local-tools-2026-08-24.json");
const reportPath = resolve("evals/results/local-tools-2026-08-24.md");
const scriptPath = resolve("scripts/benchmark-local-tools.mjs");

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function benchmark(name, iterations, operation, warmups = Math.min(1_000, iterations)) {
  for (let index = 0; index < warmups; index += 1) operation();
  const samplesUs = new Array(iterations);
  const totalStarted = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    const started = process.hrtime.bigint();
    operation();
    samplesUs[index] = Number(process.hrtime.bigint() - started) / 1_000;
  }
  const totalUs = Number(process.hrtime.bigint() - totalStarted) / 1_000;
  samplesUs.sort((left, right) => left - right);
  return {
    name,
    iterations,
    meanUs: round(totalUs / iterations),
    p50Us: round(percentile(samplesUs, 0.5)),
    p95Us: round(percentile(samplesUs, 0.95)),
    p99Us: round(percentile(samplesUs, 0.99)),
    maxUs: round(samplesUs.at(-1)),
    operationsPerSecond: Math.round(iterations / (totalUs / 1_000_000)),
  };
}

const coldSamplesMs = [];
for (let index = 0; index < 15; index += 1) {
  const child = spawnSync(process.execPath, [scriptPath, "--cold-child"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || `Cold child exited ${child.status}`);
  coldSamplesMs.push(JSON.parse(child.stdout).moduleLoadMs);
}
coldSamplesMs.sort((left, right) => left - right);

const moduleLoadStarted = performance.now();
const { searchManual } = require(`${compiledRoot}/manual-search.js`);
const { resolveSpecQuery } = require(`${compiledRoot}/specs.js`);
const { assessJobRisk } = require(`${compiledRoot}/safety.js`);
const { recommendProcess } = require(`${compiledRoot}/process-recommendation.js`);
const { assessPowerSource } = require(`${compiledRoot}/power-source.js`);
const { checkRepairScope } = require(`${compiledRoot}/repair-scope.js`);
const { getSourcePage } = require(`${compiledRoot}/source-page.js`);
const {
  defaultCheckerOutput,
  validateCheckerOutput,
  validateWriterOutput,
} = require(`${compiledRoot}/orchestration.js`);
const parentModuleLoadMs = performance.now() - moduleLoadStarted;

const publishedDutyCycle = {
  spec: "duty_cycle",
  process: "MIG",
  inputVoltage: 240,
  amperage: 200,
};
const missingDutyCycle = { ...publishedDutyCycle, amperage: 190 };
const riskStop = { activity: "bypass_protection" };
const riskContext = {
  activity: "welding",
  container: "open_never_hazardous",
  workspace: "dry",
  ventilation: "adequate",
  combustibles: "cleared",
  ppe: "complete",
  coating: "bare_known",
  structuralCriticality: "noncritical",
};
const riskEvidence = [{ id: "risk", tool: "assess_job_risk", result: assessJobRisk(riskStop) }];
const deterministicChecker = defaultCheckerOutput(riskEvidence);
const validWriter = {
  paragraphs: [{ text: "Stop. Do not bypass the protection.", evidenceIds: ["risk"] }],
};

const benchmarks = [
  benchmark("lookup_spec: published duty cycle", 50_000, () => resolveSpecQuery(publishedDutyCycle)),
  benchmark("lookup_spec: explicit miss", 50_000, () => resolveSpecQuery(missingDutyCycle)),
  benchmark("lookup_spec: polarity", 50_000, () =>
    resolveSpecQuery({ spec: "polarity", process: "flux_cored" }),
  ),
  benchmark("search_manual: focused hit, limit 1", 300, () =>
    searchManual({ query: "bird nest wire feed", limit: 1 }),
  ),
  benchmark("search_manual: multi-term hit, limit 5", 300, () =>
    searchManual({ query: "MIG porosity polarity gas CTWD", limit: 5 }),
  ),
  benchmark("search_manual: explicit miss", 300, () =>
    searchManual({ query: "E99", limit: 1 }),
  ),
  benchmark("assess_job_risk: stop rule", 50_000, () => assessJobRisk(riskStop)),
  benchmark("assess_job_risk: complete safe context", 50_000, () => assessJobRisk(riskContext)),
  benchmark("recommend_process: constrained unique match", 50_000, () =>
    recommendProcess({
      skillLevel: "low",
      shieldingGas: "unavailable",
      location: "outdoor_or_windy",
      material: "steel",
      materialCondition: "rusty_or_dirty",
    }),
  ),
  benchmark("assess_power_source: complete wall source", 50_000, () =>
    assessPowerSource({
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
    }),
  ),
  benchmark("assess_power_source: unsupported battery", 50_000, () =>
    assessPowerSource({ sourceType: "battery_bank", voltageVac: 240 }),
  ),
  benchmark("check_repair_scope: internal PCB", 50_000, () =>
    checkRepairScope({ action: "replace the main PCB" }),
  ),
  benchmark("check_repair_scope: deenergized consumable", 50_000, () =>
    checkRepairScope({ action: "replace the contact tip", powerOff: true, unplugged: true }),
  ),
  benchmark("get_source_page: reviewed detail render", 50_000, () =>
    getSourcePage({ kind: "document_page", source: "files/owner-manual.pdf", page: 7, view: "detail" }),
  ),
  benchmark("checker validation: deterministic stop", 50_000, () =>
    validateCheckerOutput(deterministicChecker, riskEvidence),
  ),
  benchmark("writer validation: grounded stop", 50_000, () =>
    validateWriterOutput(validWriter, deterministicChecker, riskEvidence, "Can I bypass it?"),
  ),
  benchmark("MCP payload: search + JSON serialization", 300, () =>
    JSON.stringify(searchManual({ query: "bird nest wire feed", limit: 2 })),
  ),
];

const memory = process.memoryUsage();
const payload = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  corpus: {
    reviewedSourcesAndPages: 54,
    structuredFacts: 15,
    processSelectionProfiles: 4,
    powerSourceRecords: 1,
    repairScopeRecords: 3,
  },
  coldInitialization: {
    samples: coldSamplesMs.length,
    p50Ms: round(percentile(coldSamplesMs, 0.5)),
    p95Ms: round(percentile(coldSamplesMs, 0.95)),
    minMs: round(coldSamplesMs[0]),
    maxMs: round(coldSamplesMs.at(-1)),
    parentModuleLoadMs: round(parentModuleLoadMs),
  },
  benchmarks,
  memoryMiB: {
    rss: round(memory.rss / 1024 / 1024, 2),
    heapUsed: round(memory.heapUsed / 1024 / 1024, 2),
  },
};

const lines = [
  "# Local MCP performance benchmark",
  "",
  `Generated: ${payload.generatedAt}`,
  "",
  "No network or model calls are included. Times cover the deterministic functions behind the in-process MCP tools.",
  "",
  "## Cold initialization",
  "",
  `- p50: ${payload.coldInitialization.p50Ms.toFixed(2)} ms`,
  `- p95: ${payload.coldInitialization.p95Ms.toFixed(2)} ms`,
  `- range: ${payload.coldInitialization.minMs.toFixed(2)}–${payload.coldInitialization.maxMs.toFixed(2)} ms`,
  "",
  "## Warm operations",
  "",
  "| Operation | p50 | p95 | p99 | Throughput |",
  "|---|---:|---:|---:|---:|",
  ...benchmarks.map(
    (result) =>
      `| ${result.name} | ${result.p50Us.toFixed(2)} µs | ${result.p95Us.toFixed(2)} µs | ${result.p99Us.toFixed(2)} µs | ${result.operationsPerSecond.toLocaleString()} ops/s |`,
  ),
  "",
  "## Memory",
  "",
  `- RSS: ${payload.memoryMiB.rss.toFixed(2)} MiB`,
  `- Heap used: ${payload.memoryMiB.heapUsed.toFixed(2)} MiB`,
  "",
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(reportPath, lines.join("\n"));
process.stdout.write(`${lines.join("\n")}\n`);
