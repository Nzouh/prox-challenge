# Source extraction workflow

The knowledge build follows this routing flow:

```text
PDF page
  ├─ text-only → deterministic embedded-text extraction
  └─ complex   → deterministic embedded-text extraction
                 + high-resolution page render
                 + local OCR when embedded text is sparse
                 + required human visual-review record
                         ↓
                unified page Markdown
                         ↓
          structured facts and troubleshooting graph
                         ↓
             provenance validation gate
```

Product JPEG/WebP images enter the complex branch directly. Near-white margins are
cropped only in a derived detail render; the original source and full render remain
available. OCR records retain bounding boxes and confidence values.

## Determinism and provenance

- `knowledge/` is generated; edit the extractor or its review inputs, never its output.
- Every source is recorded with a SHA-256 hash in `knowledge/manifest.json`.
- Every page records its classification, extraction paths, source page, Markdown,
  full/detail render, OCR records when used, and review state.
- Structured facts include their source file and PDF page.
- `--require-reviewed` exits unsuccessfully if any complex page or source image lacks
  a visual-review record.
- OCR is cached only when the exact detail-render hash matches. PDF and source-image
  renders are regenerated when their source file is newer.

## Build and validate

```powershell
.\.venv\Scripts\python.exe scripts\extract_knowledge.py --require-reviewed
.\.venv\Scripts\python.exe -m unittest scripts.test_extraction
```
