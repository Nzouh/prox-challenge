# PLAN — Vulcan OmniPro 220 Agent

Working notes behind `CLAUDE.md`. Not loaded every session — read this when you need the
*why*, or when you're about to reverse a decision someone already made deliberately.

---

## 1. What we're building against

Build a multimodal reasoning agent for the Vulcan OmniPro 220 using the Claude Agent SDK.
Fork the repo, run in under two minutes with a single `ANTHROPIC_API_KEY`. Graded on:

1. **Deep technical accuracy** — questions that cross-reference multiple manual sections,
   require reading visual content, or are ambiguous enough to need clarification.
2. **Multimodal responses** — the brief calls this "the most important part." Surfaced
   figures, generated diagrams, interactive content. Not text-only.
3. **Tone** — the user is in their garage. Capable, not a professional welder.
4. **Knowledge extraction quality** — critical information exists only in images.

### Measured facts that drove every decision below

| Fact | How we know | Consequence |
|---|---|---|
| ~24k tokens of extractable text across all three PDFs | `pdftotext`: 15,192 words in the manual | The whole corpus fits in context many times over |
| `selection-chart.pdf` extracts **0 words** | single 1200×1200 JPEG at 72 PPI | Text retrieval literally cannot see it |
| `quick-start-guide.pdf` extracts 93 words | 2 pages, near-pure image | Same |
| The duty-cycle table lives in `product-inside.webp` | door placard: MIG/Flux 240VAC = 20% @ 200A | The brief's own first test question is answered by pixels in the repo root |
| p.42 troubleshooting columns interleave when parsed | problem name lands mid-causes-column | Tables must be rebuilt by vision, not parsed |
| Manual pp. 8–9 (Controls) extract 49 and 79 words | labeled panel diagrams | Visual-only content is concentrated, not incidental |
| Duty cycle appears in three independent places | placard, p.7 specs, selection-chart explainer | Cross-validation is possible and free |
| The selection chart is already a decision tree | skill → gas → material → thickness → process | The configurator flow is designed for us |

---

## 2. Decision log

### Knowledge

| Decision | Why | Rejected |
|---|---|---|
| No vector DB / RAG | 24k-token corpus; the two highest-value sources have no text to embed; chunking shreds the troubleshooting matrix; top-k defeats the cross-referencing the brief tests | Embeddings + retrieval |
| No fine-tuning | Not offered for Claude; teaches style not facts; makes numeric hallucination *worse* | Training on the 48 pages |
| Claude Agent SDK (`query()`) | Brief mandates the Agent SDK and a single Anthropic key. Consequence: the SDK owns the request envelope, so the caching design is shaped by what it exposes — see §3 | OpenRouter; raw Messages API |
| Whole corpus in the cached system prompt | Fits trivially; caches from 512 tokens on Opus 5, reads ~0.1×; no retrieval step means no retrieval errors | Per-query fetching |
| Build-time extraction, committed to `knowledge/` | Tables need vision to rebuild correctly; committing makes the base auditable and reviewable in a PR | Runtime PDF parsing |
| Product photos are **primary sources** | `product-inside.webp` holds the duty-cycle table | Treating them as decoration |
| Narrow troubleshooting graph as JSON | Content is already symptom → causes → checks → fixes, with page cross-references as edges; a few hundred nodes | Graph database |

### Architecture

| Decision | Why | Rejected |
|---|---|---|
| Frozen `systemPrompt` string; session state carried after it, never inside it | Any byte change invalidates the cached prefix. The Agent SDK takes `systemPrompt` as a plain string and places `cache_control` itself; it exposes no `role:"system"` slot in `messages[]` to hold state, so the carrier is an open call — see §3 | Interpolating state into the system prompt |
| No built-in tools, no filesystem settings | `tools: []` and `settingSources: []` on `query()`. Otherwise the agent can answer by reading the repo instead of calling a tool — breaking "looked up, never generated" — and inherits whatever `CLAUDE.md` and settings happen to sit on the grader's machine | Letting Claude Code's default toolset through |
| Numbers looked up, never generated | Deletes the entire class of numeric hallucination structurally, rather than by training | Trusting recall |
| Three provenance tiers, never blurred | Wrong duty cycle kills the machine; wrong polarity is a fire risk. Calibrated hedging *is* accuracy | One confident voice for everything |
| Structured artifact JSON against a strict schema | Agent picks a component and fills params; we own rendering, so malformed output is impossible | Agent writes raw HTML/JS as the primary path |
| Sandboxed cross-origin iframe as escape hatch | Covers the long tail without putting generated markup in our origin | Same-origin rendering |
| Explicit `plan_response` step | Routing becomes separately auditable and eval-able, and visible reasoning is a demo asset | Implicit routing via tool choice |
| Expertise + depth as first-class session state | Directly serves the tone criterion; almost nobody builds it explicitly | Prompt-level hinting |
| Native web search with a domain allowlist | No scraper to maintain, no DOM breakage, no legal grey area | Custom scraping |
| 2.5D hotspots over the real photos | No 3D model of the machine exists; the photos *are* the outside/inside pair; the placard stays legible zoomed | Modeling the welder |
| Parametric 3D for geometry only | Gun angle, CTWD, joint types, weld positions are genuinely 3D and impossible in a photo | Static 3D assets |

### Stack & scope

| Decision | Why | Rejected |
|---|---|---|
| Next.js + TS + React + R3F | Key stays server-side; one command satisfies the 2-minute rule; streams natively; deploys under an existing domain | Vite SPA + separate Express server |
| Voice cut from v1 | Filed under "sky is the limit," not a graded criterion; can't do voice *and* 3D well in a week | ElevenLabs / Web Speech |
| Vertical slice before breadth | Front-load unknown risk (streaming, artifact rendering), not known labour (extraction) | Layer-by-layer build |

---

## 3. Developer-side architecture (conceptual)

### Input — four sources, one envelope

A turn can originate from typed text, an uploaded image (user photographs their weld or
machine), a hotspot click on the product photo, or an interaction with a rendered artifact.
All four normalize into the same request shape before reaching the agent.

The image path matters more than it looks: the manual has a full weld-diagnosis section, so
"here's a photo of my porous weld" diagnosed against it is one of the strongest demos.

> TODO: input union type will live in `lib/agent/input.ts`.

### The request envelope — frozen vs. volatile

The split is the whole caching strategy. The Agent SDK constrains how we express it:

- **Frozen prefix** — the `systemPrompt` string: instructions, full extracted corpus, table
  JSON, graph. Byte-identical forever, cached. Always our own string, never the
  `claude_code` preset — the preset injects per-session dynamic sections that would break
  byte-identity on every request.
- **Volatile suffix** — the session state snapshot (expertise, machine config, symptoms
  reported, fixes already tried, selected part), then the user turn.

The SDK exposes no `role:"system"` slot in `messages[]`, so the snapshot needs another
carrier. Three candidates, decided on day 3 when there is real state to carry:

1. A synthetic `SDKUserMessage` with `shouldQuery: false` — appended to the transcript
   without triggering an assistant turn. Closest analogue to a mid-conversation system
   message, and keeps state out of the user's own words.
2. A state preamble prepended to each user turn's text. Simplest; muddies the transcript.
3. A `get_session_state` tool the agent pulls when it needs it. Costs a round trip, but
   makes every use of state auditable.

Leaning (1). Whichever wins, state goes *after* the frozen prefix, never into it — that part
is not negotiable, only the mechanism is.

Verify with `cache_read_input_tokens` on `SDKResultMessage.usage` every turn. Zero across
turns means something is invalidating the prefix and we're silently paying ~10×.

> TODO: envelope assembly will live in `lib/agent/request.ts`.

### Deciding how to answer

Three orthogonal decisions per turn, emitted as one structured plan before the answer:
whether to clarify or answer, which modalities to use, and what register (expertise level ×
quick-vs-complete).

**The clarify heuristic:** ambiguity alone is not a reason to ask. If the answer space is
small (≤6 combinations), answer *exhaustively* — "what's the duty cycle?" spans 3 processes ×
2 voltages, so show all six and highlight the likely one. Ask only when the space is large, or
when the wrong branch is dangerous (an unidentified part, an electrical question).

> TODO: plan schema will live in `lib/agent/plan.ts`.

### Tool responsibilities

Five jobs, one tool each: deterministic spec lookup against the extracted tables; figure
retrieval returning a real image block; traversal of the troubleshooting and setup graphs;
allowlisted web search for Tier 2; and artifact emission against the component schema.

Figures are fetched on demand, never preloaded — 51 page images would swamp the context that
the whole design exists to keep small.

Tool contracts, safety guardrails, staged validation, and incremental batches live in
`docs/tools.md`.

### Rendering

Six known component types (duty-cycle calculator, troubleshooting flow, settings configurator,
panel hotspot map, 3D geometry scene, cable routing) render from typed params. Anything else
goes to the sandboxed iframe.

For the troubleshooting flow, *our code* generates the diagram from the graph after a
deterministic traversal — the agent never authors diagram syntax, so it cannot invent an edge.

> TODO: component schemas will live in `docs/artifacts.md`.

---

## 4. Grounding and validation

### Three tiers

1. **The manual** — authoritative, cited to page and figure.
2. **Allowlisted web** — corroborating, cited to URL, explicitly marked non-manual.
3. **Inference** — from Tier 1 specs or general welding engineering, explicitly marked.

The UI must render these visually distinctly. An agent that says "the manual doesn't cover
this, but here's what it does specify" scores better than one that confabulates fluently.

### Four validation layers

1. **Build time — triangulation.** Each page is read twice by different mechanisms: vision
   over the rendered PNG, and the deterministic `pdftotext` layer. Diff them, with a numeric
   set-diff as the primary signal since every spec that matters is a number. Where a fact
   appears in multiple sources (duty cycle appears in three), diff those too. Unresolved
   conflicts fail the build and get resolved by hand, with the resolution recorded.
2. **Runtime — lookup, not recall.** Spec values come from JSON. The model chooses the query.
3. **Citation enforcement.** A Tier-1 claim with neither a citation nor a tool call behind it
   is a detectable bug — log it, and fail it in the eval harness.
4. **Safety-critical self-check.** For polarity, voltage, duty cycle, and anything that could
   damage the machine or injure someone, one cheap second pass asks which claims the sources
   don't support. Gated on the flag, not every turn.

Verification of a dense visual table is as hard as the original extraction — use the same
model tier or better. A weaker model there produces false confidence. (A weaker model is fine
for layer 4, which is a much easier task.)

---

## 5. Build order

Principle: **risky unknowns first, laborious knowns second.** Extraction will take the time it
takes and won't surprise us. Artifact rendering can.

| Day | Work |
|---|---|
| 1 | **Vertical slice.** Scaffold Next.js. Hand-crop the duty-cycle table and hand-write the value as a fixture under `lib/agent/fixtures/` — *not* `knowledge/`, which stays empty until day 2's extractor generates it. Wire two tools, `lookup_spec` and `emit_artifact`. Drive "MIG at 200A on 240V" end to end: typed question → streamed answer → rendered artifact. Hardcoded is fine. Proves streaming, the agent loop, tool calls, artifact rendering, and an image-sourced fact in one day. |
| 2 | **Extraction.** All 48 pages + selection chart + both product photos → page PNGs, figure crops, page markdown, table JSON, troubleshooting graph, validation report. Write eval questions while reading — that's when you notice what's hard. |
| 3 | **The real agent.** Cached corpus, full tool set, citations, provenance tiers, session state, expertise tracking. Eval set to ~40 questions, first run. |
| 4 | **Hotspot map.** Both photos: hover highlight, click-to-zoom, part-scoped chat, inside↔outside toggle. |
| 5 | **Artifacts + parametric 3D.** The six component types; R3F scenes for gun angle, CTWD, joint geometry, weld positions. |
| 6 | **Tier 2 web search**, tone pass, full eval run, fixes. |
| 7 | **README, video walkthrough, deploy.** |

Dense pages (placard, selection chart, p.42 matrix, p.7 specs) need a second extraction pass:
crop to the content region first, then render that crop large. Rendering a full page above
~1568px on the long edge buys nothing — the resolution gain comes from cropping.

---

## 6. Open questions

- **Session-state carrier** — the Agent SDK has no `role:"system"` message, so the volatile
  half of the envelope needs one of the three carriers in §3. Decide on day 3, against real
  state and a real `cache_read_input_tokens` reading.
- **Portfolio stack** — determines whether `zouhari.dev/arc` attaches via Next.js rewrites /
  multi-zones or a subdomain. Build standalone regardless; the brief requires local run.
- **Voice** — deferred, not abandoned. If days 6–7 go unexpectedly well, browser speech input
  with an optional TTS key that degrades gracefully when absent. It must never become required,
  or the single-key clone-and-run guarantee breaks.
- **Eval harness shape** — routing decisions (did it correctly choose to ask?) should be scored
  separately from prose quality. Design once there are enough questions to see the pattern.
