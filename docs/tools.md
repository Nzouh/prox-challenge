# MCP tool and guardrail roadmap

This is the durable design record for the Vulcan OmniPro 220 MCP surface. Implement
tools in small batches, measure their usefulness and latency, and keep only boundaries
that improve correctness.

## Architectural boundary

MCP tools are deterministic capabilities, not agents. The application orchestrator owns
the model roles and the validation loop:

```text
User question
  -> deterministic route selection
       -> exact low-risk spec: Haiku routes the MCP call
       -> other questions: Opus research/router selects read-only MCP tools
  -> tool input schema validation
  -> deterministic tool execution over validated knowledge
  -> evidence/provenance validator
       -> retry tool call with corrected arguments when recoverable
       -> stop safely when evidence is missing or contradictory
  -> after evidence validation, run in parallel:
       -> safety/grounding checker builds an approved response plan when required
       -> writer drafts only from evidence and deterministic safety constraints
  -> join checker + writer results
  -> final deterministic checker verifies citations, safety status, and artifacts
  -> UI receives done only when every stage is error-free
```

The checker and writer are orchestration stages, not MCP tools. The writer never receives
permission to browse, read files, or manufacture a specification. For low-risk factual
questions the checker may be deterministic code; safety-critical or inference-heavy
answers get a second model pass. The first writer attempt runs concurrently with that pass,
but its text stays buffered until the critic and deterministic final checker approve it. A
failed final check is retried within a fixed budget and never converted to a successful
`done` event. Anthropic research sessions are persisted and resumed for follow-up turns.
For a complete exact specification intent, Haiku performs the MCP-routing turn and the host
recomputes and matches the tool result before rendering it deterministically. That path
skips Opus, the model checker, and the separate writer; any mismatch falls back to the full
Opus attempt. Independent MCP calls are requested in one batch and execute concurrently;
dependent calls remain sequential.
Question-only response replay is disabled because it loses conversational state and can
replay stale evidence; any future cache must include the exact conversation and evidence
revision without sharing SDK sessions between users.

## Source policy

1. Tier 1: the exact supplied manual, quick-start guide, selection chart, or product image.
2. Tier 2: an allowlisted authoritative source such as OSHA or the manufacturer, clearly
   labeled as outside the supplied manual.
3. Tier 3: explicit inference, with its source facts listed.

Every Tier-1 result identifies the source file, PDF page or figure, and corpus/source hash.
Tools read only pages that passed `knowledge/validation/report.json`. Full and detail PNGs,
OCR records, deterministic text, and the recorded visual review remain linked in
`knowledge/manifest.json`.

Never silently merge different product revisions. For example, a product page and a
supplied manual may publish different values. Return `source_conflict` with both citations
or use a recorded authority decision for the exact source revision.

## Tool roadmap

### Retrieval and machine facts

#### `search_manual`

Search validated page Markdown and return short passages with source/page provenance.
This is the open-ended fallback for safety, maintenance, technique, controls, and topics
that do not fit a structured table. A miss is explicit and never authorizes model recall.

#### `lookup_spec`

Query structured generated facts. Supported dimensions grow with `facts.json`, including:

- duty cycle by process, voltage, and output current;
- welding-current range by process and voltage;
- open-circuit voltage;
- wire-speed and spool capacity;
- wire sizes, weldable materials, gas requirements, and cable polarity.

#### `get_setup`

Return ordered, source-backed setup steps and cable polarity for MIG, flux-cored, TIG, or
Stick. It must distinguish required, optional, disconnected, and technician-only items.

#### `diagnose_problem`

Traverse a generated troubleshooting graph. Return causes, operator checks, stop
conditions, prohibited actions, technician-only actions, and source pages.

#### `recommend_process`

Traverse the selection-chart data using skill level, material, thickness, gas availability,
location, and desired cleanliness. `unsupported` or `insufficient_information` is preferable
to guessing. The implemented result first rejects hard conflicts, then ranks only compatible
processes and preserves charted spool-gun, DC TIG, and AC TIG requirements.

### Safety guardrails

#### `assess_job_risk`

Evaluate explicitly supplied context against deterministic rules. Missing values stay
unknown; they are never assumed safe. Candidate inputs include material/coating, previous
container contents, sealed or pressurized state, ventilation, confined space, wetness,
combustibles, PPE, structural criticality, power source, repair action, and user experience.

Output: risk level, triggered rule IDs, stop conditions, minimum controls, unanswered
critical questions, escalation target, and provenance for every rule.

#### `lookup_fault_indicator`

Look up an exact display message, symptom, or documented code. Do not seed invented codes.
An unknown indicator returns `unknown_indicator`, a prohibition on bypassing protection,
and neutral next steps such as recording the exact display and consulting the matching
manual/manufacturer. It must not prescribe condition-specific cooling or power actions when
the condition is unknown.

#### `assess_power_source`

Check voltage, frequency, waveform, continuous capacity, receptacle, grounding/bonding, and
manufacturer approval. A voltage match alone is never sufficient. Distinguish published
input current at rated output from a maximum branch-circuit requirement. The implemented
guardrail treats generators, inverters, battery banks, EVs, and other non-wall sources as
unsupported unless separately approved, and returns `needs_verification` when required
conditions are omitted.

#### `check_repair_scope`

Classify work as `operator_permitted`, `deenergized_inspection_only`,
`qualified_technician_required`, `explicitly_prohibited`, or `not_documented`. Internal
wiring, energized enclosure work, and bypassing protection cannot fall through to ordinary
troubleshooting. The implemented index is grounded in the manual's maintenance, grounding,
and parts-repair warnings and is recomputed by the host before evidence is accepted.

#### `get_source_page`

Return the exact reviewed detail/full render for a PDF page or product image from
`knowledge/manifest.json`, including the markdown path, selected asset path, and tier-1
source hash. Unknown sources and pages fail closed.

## Artifact roadmap

`emit_artifact` accepts only allowlisted schemas grounded in successful tool results:

The artifact tool is exposed only when the user explicitly requests a visual, diagram,
chart, or calculator. A direct single-value lookup renders as normal prose.

- specification card;
- cable-setup diagram;
- step-by-step setup checklist;
- duty-cycle visualization;
- troubleshooting decision tree;
- process-comparison table;
- safety stop card;
- pre-weld hazard checklist;
- power-source compatibility report;
- technician-escalation card.

Artifacts present decisions; they do not make them. Code renders diagrams from validated
nodes and edges. The model never authors executable React or diagram syntax for a
safety-critical artifact.

## Incremental implementation

### Batch 1 — corpus reach and first guardrail (implemented)

- Replace the Day 1 fixture with generated `facts.json` in `lookup_spec`.
- Add `search_manual` over visually validated page Markdown.
- Add the first deterministic `assess_job_risk` rules.
- Add tool-level schema/provenance validation and tests for misses and unsafe cases.

### Batch 2 — guided operation

- Implemented `get_setup` for all four processes across cable, workpiece, consumables,
  power/control, and shutdown stages. The optional cable-setup artifact remains separate.
- Implemented `diagnose_problem` for all twelve unique troubleshooting symptoms on manual
  pages 42–44, with shutdown prerequisites, operator checks, remedies, and technician-only
  repair-scope fields.
- Implemented `lookup_fault_indicator` for the two documented generic warning conditions.
  Undocumented strings and codes return `unknown_indicator` without borrowing a remedy
  from a similar condition.
- Added host-side recomputation and adversarial tests before exposing all three tools to
  the Anthropic SDK research agent.

Current structured coverage: 15 exact machine facts, four cable setups, twenty operating
setup sections, twelve diagnostic symptom nodes, two documented warning conditions, one
power-source record, three repair-scope records, and four process-selection profiles.
The durable next-tool order remains in this file and is mirrored in `todo.md`.

### Batch 3 — compatibility and selection

- Implemented `assess_power_source` with voltage-plus-circuit guardrails and explicit
  unsupported-source outcomes for generators, inverters, battery banks, and EVs.
- Implemented `check_repair_scope` with operator, deenergized-only, technician, prohibited,
  and undocumented outcomes.
- Implemented `recommend_process` from the visually reviewed selection chart with four
  complete process profiles and natural-language routing through the Anthropic SDK.
- Added process-selection evaluation questions for clean indoor sheet, rusty outdoor steel,
  24-gauge stainless, 1/2-inch outdoor steel, aluminum automotive body work, and missing
  decision context.
- Live Anthropic evaluation passed 7/7 process-selection questions. Every question selected
  `recommend_process` on the first research attempt with no forced tool choice and no retry.
- Implemented `get_source_page` against the reviewed manifest; source-page UI rendering
  remains a frontend task.
- Live Anthropic evaluation passed 6/6 questions for the three remaining tools. The
  battery/EV question used one bounded retry because its first attempt omitted the required
  parallel `assess_job_risk` evidence; no answer was released before that safety check.

### Validation/checker/writer foundation (implemented with Batch 1)

- Research agent has read-only MCP access.
- Host recomputes and validates every evidence result before accepting the tool result.
- Missing risk assessment or missing evidence triggers one bounded research retry.
- Safety-signaled questions pass through a no-tools checker agent.
- The no-tools checker and first no-tools writer attempt run concurrently after evidence
  validation; neither can block or weaken the deterministic risk disposition.
- Artifacts and text remain buffered until a deterministic final checker passes.
- `done` is emitted only after all stages complete without errors.

### Batch 4 — orchestration evaluation and tuning

- Tune the implemented safety-signal gate for checker cost, latency, and false negatives.
- Run adversarial evaluations: fake codes, bypass requests, DIY internal repair, unknown
  coatings, sealed containers, wet work areas, unsupported power sources, and source
  revision conflicts.

## Initial efficiency metrics

For every tool and end-to-end test record correctness, unsupported-answer rate, unsafe
false-negative rate, p50/p95 latency, tool-call count, model turns, tokens, cache reads, and
cost. A new tool stays only if it improves correctness or meaningfully reduces model work.

### Batch 1 measurements — 2026-08-24 local development

Deterministic calls after warm module load:

| Operation | p95 latency |
|---|---:|
| `lookup_spec` | 0.32 ms |
| `search_manual` with contextual table-row excerpt | 7.72 ms |
| `assess_job_risk` | 0.004 ms |

Single end-to-end smoke tests (model/network timings vary):

| Question path | Result | Latency | Estimated cost |
|---|---|---:|---:|
| Duty-cycle lookup + artifact + writer | passed | 17.6 s | $0.0196 |
| Manual bird-nest search + writer | passed | 16.8 s | $0.0177 |
| Protection-bypass risk + checker + writer | passed | 27.8 s | $0.0232 |

The first risk smoke test was correctly withheld because the checker confused approving a
safe refusal with approving the requested bypass. The checker contract was corrected and
the repeated test passed with an explicit `Do not bypass` response. A manual-search smoke
test also led to a retrieval improvement: deterministic/OCR text now outranks visual-review
summaries, wrapped table rows are scored in context, and one result is the default to reduce
tokens and over-citation.
