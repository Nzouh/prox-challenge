# Reference images

These are the original visual inputs and reviewer-facing comparison images used to build
Arc. Runtime imports, extraction scripts, and calibration tooling should reference files
here rather than placing loose images in the repository root.

- `product-views/` â€” supplied exterior, front, open-door, and feed-bay product views.
- `calibration/` â€” working views used to calibrate and audit hotspot placement.
- `validation/` â€” side-by-side correspondence boards for the front and inside views.
- `branding/` â€” source artwork used to derive the transparent Arc mark in `public/`.

The generated, deployment-facing PDF and product-image renders remain under `knowledge/`.
Those assets are reproducible outputs of `scripts/extract_knowledge.py`, not source images.
