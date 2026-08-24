# MCP tool and guardrail roadmap

This is the durable design record for the Vulcan OmniPro 220 MCP surface. Implement
tools in small batches, measure their usefulness and latency, and keep only boundaries
that improve correctness.

## Architectural boundary

MCP tools are deterministic capabilities, not agents. The application orchestrator owns
the model roles and the validation loop:

```text
User question
  -> research/router agent selects read-only MCP tools
  -> tool input schema validation
  -> deterministic tool execution over validated knowledge
  -> evidence/provenance validator
       -> retry tool call with corrected arguments when recoverable
       -> stop safely when evidence is missing or contradictory
  -> safety/grounding checker builds an approved response plan
  -> writer agent writes only from the approved plan and evidence
  -> final deterministic checker verifies citations, safety status, and artifacts
  -> UI receives done only when every stage is error-free
```

The checker and writer are orchestration stages, not MCP tools. The writer never receives
permission to browse, read files, or manufacture a specification. For low-risk factual
questions the checker may be deterministic code; safety-critical or inference-heavy
answers get a second model pass. A failed final check is retried within a fixed budget and
never converted to a successful `done` event.

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
to guessing.

#### `get_source_page`

Return the exact reviewed detail PNG/full page and its provenance. The model must not redraw
or paraphrase a wiring schematic when the source image is the authoritative representation.

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
input current at rated output from a maximum branch-circuit requirement.

#### `check_repair_scope`

Classify work as `operator_permitted`, `deenergized_inspection_only`,
`qualified_technician_required`, `explicitly_prohibited`, or `not_documented`. Internal
wiring, energized enclosure work, and bypassing protection cannot fall through to ordinary
troubleshooting.

## Artifact roadmap

`emit_artifact` accepts only allowlisted schemas grounded in successful tool results:

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

- Add `get_setup` and a cable-setup artifact.
- Add `diagnose_problem` with repair-scope fields.
- Add `lookup_fault_indicator` without assuming undocumented error-code names.

### Batch 3 — compatibility and selection

- Add `assess_power_source` and `check_repair_scope`.
- Add `recommend_process` from the selection chart.
- Add `get_source_page` and source-page UI support.

### Validation/checker/writer foundation (implemented with Batch 1)

- Research agent has read-only MCP access.
- Host recomputes and validates every evidence result before accepting the tool result.
- Missing risk assessment or missing evidence triggers one bounded research retry.
- Safety-signaled questions pass through a no-tools checker agent.
- A no-tools writer agent runs only after approval.
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
