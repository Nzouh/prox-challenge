# Vulcan OmniPro 220 Agent

Multimodal reasoning agent for the Vulcan OmniPro 220 multiprocess welder, built on the
Anthropic Claude Agent SDK. Answers deep technical questions — duty cycles, polarity, weld
diagnosis, parts — for someone in their garage who is capable but not a professional welder.
Not text-only: it surfaces manual figures, draws diagrams, and generates interactive content.
Graded on technical accuracy, multimodal quality, tone, and knowledge extraction. Ships as a
forked repo, hosted at zouhari.dev/arc.

## Stack

Next.js + TypeScript + React + React Three Fiber — Next.js so the Anthropic key stays
server-side and the app runs from a single command.

## Run

`cp .env.example .env` (set `ANTHROPIC_API_KEY`), then `npm install && npm run dev`.
The key is server-side only — never `NEXT_PUBLIC_*`, never shipped to the browser.

## Invariants

- System prompt is frozen and byte-identical across requests — no timestamps, IDs, or
  conditional sections, and never the `claude_code` preset. Session state is carried after the
  cached prefix, never inside it; the Agent SDK has no `role:"system"` message, so the carrier
  itself is an open call (`PLAN.md` §3).
- Specs and numbers are looked up from `knowledge/`, never generated.
- Every claim carries a provenance tier (1 manual / 2 web / 3 inference); the UI renders the
  tiers visually distinctly. Never blur them.
- `knowledge/` is build-generated and committed — never hand-edit; fix the extractor and rerun.
- Interactive output: the agent fills params for components that already exist. Freeform markup
  renders only inside the sandboxed cross-origin iframe.
- Nothing may break the one-command, two-minute clone-to-running path.

## Docs

- `PLAN.md` — decision log, architecture, build order.
- *Not yet written:* `knowledge/README.md` (what's extracted), `docs/extraction.md` (page →
  vision → validate pipeline), `docs/tools.md` (tool contracts), `docs/artifacts.md`
  (component schemas + iframe host).
