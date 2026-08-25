# TODO

This is the working execution order for the Vulcan OmniPro 220 agent. Keep completed
items checked and add evaluation findings beneath the relevant section.

## 1. Response latency and orchestration

- [x] Benchmark the deterministic local MCP layer. Results are stored in
  `evals/results/local-tools-2026-08-24.md`; the slowest measured broad search remains
  below 100 ms at p99.
- [ ] Record p50/p95 end-to-end latency, stage latency, model turns, tool calls, tokens,
  cache reads, and cost during the evaluation run.
- [x] Run the safety checker and first writer attempt concurrently after MCP evidence has
  been retrieved and deterministically validated.
- [x] Keep Claude Opus 5 for evidence research, with Claude Sonnet 5 as its fallback.
- [x] Keep Claude Haiku 4.5 for the constrained checker and writer, with Claude Sonnet 5
  as their fallback.
- [x] Stream immediate, truthful progress states such as `Checking the manual`,
  `Verifying safety`, and `Writing the answer`.
- [x] Disable question-only response replay because it loses conversation context and can
  reuse stale answers across unrelated SDK sessions.
- [ ] Reintroduce response caching only with an exact conversation/evidence revision key;
  never share or replay another user's Anthropic session.
- [x] Add a deterministic fast path for exact structured-spec questions so common
  duty-cycle, polarity, current-range, OCV, wire-speed, and spool-capacity questions do
  not require a full model loop. Haiku routes the MCP call; matched host-recomputed evidence
  skips Opus, the model checker, and the separate writer, while failures fall back to Opus.
- [ ] Consider caching checker outputs by the exact question, evidence payload, knowledge
  revision, prompt version, and model ID if repeated checks remain measurably expensive.
- [ ] Keep MCP lookups in-process; they already complete in milliseconds and are not the
  primary latency bottleneck.

### Performance constraints

- Do not optimistically display unverified welding instructions, safety decisions, or
  machine specifications and retract them later. A user may act before a correction
  arrives.
- Retrieval must precede grounded writing. A writer running before the required evidence
  exists can only guess and is not an acceptable latency optimization.
- Parallelism begins after successful evidence retrieval: a provisional writer can work
  from deterministically validated evidence while the independent critic checks the same
  evidence and safety disposition.
- No answer receives a successful `done` event until the final deterministic checks pass.
- It is safe to stream progress immediately; it is not safe to stream unverified claims.
- Cache only complete validated outputs, and invalidate them on process restart, knowledge
  revision, prompt/model change, or future session-state differences.

## 2. Accuracy evaluation

- [ ] Turn `docs/evaluation-questions.md` into an executable evaluation manifest with
  expected facts, expected sources, required tools, expected safety disposition, and
  forbidden claims.
- [ ] Build an evaluation runner that records each answer and machine-readable result.
- [ ] Run all 35 current questions.
- [ ] Require 100% accuracy on structured specifications.
- [ ] Require zero invented error codes, specifications, citations, or repair procedures.
- [ ] Require zero unsafe false negatives on bypass, energized enclosure, sealed-container,
  hazardous-coating, wet-area, and safety-critical structural questions.
- [ ] Score retrieval correctness, completeness, citation accuracy, clarification quality,
  unsupported-answer rate, latency, tool calls, turns, tokens, cache reads, and cost.
- [ ] Fix evaluation failures before claiming the backend is fully accurate.
- [ ] Re-run the suite after every material prompt, model, tool, extraction, or orchestration
  change.

## 3. Frontend redesign

- [x] Replace the single replaceable response with proper conversational history.
- [x] Use plain prose as the default answer format.
- [x] Hide raw MCP names, token counts, and cost behind an optional developer-details view.
- [x] Replace generic `Thinking` text with the real streamed orchestration stage.
- [ ] Add compact clickable citations that open the exact validated manual page or source
  image in a focused preview.
- [x] Visually distinguish Tier 1 manual evidence, Tier 2 external rules, and Tier 3
  inference without turning ordinary answers into dashboard cards. Tier reads from a
  label and a hue, never hue alone, in both the artifact badge and the explorer's
  source popover.
- [ ] Use restrained safety callouts only when the disposition warrants one.
- [x] Add suggested-question groups based on the evaluation set.
- [x] Add a multiline composer, keyboard behavior, copy action, follow-up action, reset,
  loading cancellation, and accessible error states. Reset is now "New conversation" in
  the sidebar, since a conversation list makes a global reset the wrong verb.
- [ ] Make the experience responsive and test it on phone, tablet, and desktop widths.
  Breakpoint written (the sidebar becomes a scrolling header strip under 900px); still
  unverified on real phone and tablet hardware.
- [ ] Keep artifacts opt-in or reserved for relationships that are materially clearer as a
  diagram, source image, calculator, or troubleshooting flow.
- [ ] Add image upload for weld or machine photographs after the text experience is stable.

## 4. MCP tool expansion

- [x] Add the first `get_setup` slice for process-specific, ordered cable setup across MIG,
  self-shielded flux-cored, TIG, and Stick, including optional/disconnected states.
- [x] Expand `get_setup` with validated workpiece, consumables, power/control, and shutdown
  stages for every supported process.
- [ ] Add the optional cable-setup artifact renderer.
- [x] Add `diagnose_problem` backed by a complete symptom → causes → checks → permitted
  remedies graph with repair-scope metadata.
- [x] Add `lookup_fault_indicator` without assuming undocumented error-code names; unknown
  codes receive no condition-specific remedy.
- [x] Add `recommend_process` from the visually validated selection chart, including
  deterministic conflict filtering, ranked/tied results, special equipment requirements,
  and explicit insufficient/unsupported outcomes.
- [x] Verify natural `recommend_process` routing against seven live Anthropic questions:
  7/7 passed, all selected the tool on the first attempt, with zero research retries.
- [x] Add `assess_power_source` for input-voltage, circuit, phase, cord, generator, battery,
  and unsupported-source questions.
- [x] Add `check_repair_scope` to separate operator maintenance from technician-only work.
- [x] Add `get_source_page` so the UI can retrieve and display the authoritative page/render.
- [x] Run six live Anthropic questions covering power-source compatibility, repair scope,
  and reviewed source-page retrieval: 6/6 passed.
- [ ] Expand structured facts beyond the current 15 records where exact table values can
  be extracted and validated deterministically.
- [x] Expand troubleshooting data from four summaries to all twelve unique manual symptom
  nodes, including every row on pages 42–44.
- [x] Add Batch-2 adversarial tests for crossed setup polarity, unknown symptoms, invented
  display codes, and condition-specific remedy leakage before enabling the tools.

## 5. Visuals and 2.5D experience

- [ ] Build outside/inside views from the two real product photographs.
- [ ] Add responsive 2.5D hotspots with hover/focus states, labels, zoom, and part-scoped
  questions.
- [ ] Animate the outside ↔ inside transition with purposeful camera/parallax motion.
- [ ] Preserve source-image fidelity; do not fabricate machine geometry or hidden parts.
- [ ] Add cable-routing diagrams generated from validated connection data.
- [ ] Add troubleshooting flows generated from deterministic graph nodes and edges.
- [ ] Add parametric scenes only where spatial understanding matters: gun angle, CTWD,
  joint preparation, and welding position.
- [ ] Respect reduced-motion preferences and provide keyboard/touch equivalents for every
  interaction.
- [ ] Test animation performance on integrated and mobile-class hardware, not only the
  development machine.

## 6. Final delivery

- [ ] Reconcile `PLAN.md`, `CLAUDE.md`, and implementation details that have changed.
- [ ] Document the real setup and run commands in `README.md`.
- [ ] Run typecheck, unit tests, extraction tests, evaluation suite, and production build.
- [ ] Complete an accessibility and responsive-layout pass.
- [ ] Deploy a review build.
- [ ] Record the walkthrough only after the final evaluation run passes.
