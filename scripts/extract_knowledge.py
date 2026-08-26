"""Build the committed Vulcan knowledge corpus from PDFs and product images.

Text-only pages use deterministic PDF text extraction. Complex pages use the same
text extraction plus a high-resolution render and a required visual-review record in
scripts/extraction_overrides.json. Never hand-edit knowledge/: fix this script or the
review inputs and rebuild.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from statistics import median
from typing import Any

import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    from scripts import hotspots
except ModuleNotFoundError:  # Direct `python scripts/extract_knowledge.py` execution.
    import hotspots


ROOT = Path(__file__).resolve().parents[1]
FILES_DIR = ROOT / "files"
OUTPUT_DIR = ROOT / "knowledge"
OVERRIDES_PATH = ROOT / "scripts" / "extraction_overrides.json"
STRUCTURED_KNOWLEDGE_DIR = ROOT / "scripts" / "structured_knowledge"
SOURCE_IMAGES = (
    ROOT / "assets" / "reference-images" / "product-views" / "product.webp",
    ROOT / "assets" / "reference-images" / "product-views" / "product-front.webp",
    ROOT / "assets" / "reference-images" / "product-views" / "product-inside.webp",
)
RENDER_DPI = 220
OCR_WORD_THRESHOLD = 100
_OCR_ENGINE: Any = None


def stable_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slug(path: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def ensure_dirs() -> None:
    for path in (
        OUTPUT_DIR,
        OUTPUT_DIR / "pages",
        OUTPUT_DIR / "renders",
        OUTPUT_DIR / "ocr",
        OUTPUT_DIR / "source-images",
        OUTPUT_DIR / "tables",
        OUTPUT_DIR / "setups",
        OUTPUT_DIR / "process-selection",
        OUTPUT_DIR / "power",
        OUTPUT_DIR / "repair",
        OUTPUT_DIR / "troubleshooting",
        OUTPUT_DIR / "validation" / "contact-sheets",
    ):
        path.mkdir(parents=True, exist_ok=True)


def load_overrides() -> dict[str, Any]:
    if not OVERRIDES_PATH.exists():
        return {"documents": {}, "source_images": {}, "structured_facts": []}
    return json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))


def load_structured_knowledge(filename: str) -> Any:
    """Load authored records that the extraction build validates and copies into knowledge/."""
    path = STRUCTURED_KNOWLEDGE_DIR / filename
    return json.loads(path.read_text(encoding="utf-8"))


def image_coverage(page: fitz.Page) -> float:
    page_area = max(page.rect.width * page.rect.height, 1)
    covered = 0.0
    for info in page.get_image_info(xrefs=True):
        bbox = fitz.Rect(info["bbox"]) & page.rect
        if not bbox.is_empty:
            covered += bbox.width * bbox.height
    return round(min(covered / page_area, 1.0), 4)


def page_metrics(page: fitz.Page) -> dict[str, Any]:
    words = page.get_text("words", sort=True)
    text_blocks = [block for block in page.get_text("blocks", sort=True) if block[6] == 0]
    drawings = page.get_drawings()
    coverage = image_coverage(page)
    return {
        "word_count": len(words),
        "text_block_count": len(text_blocks),
        "image_count": len(page.get_image_info(xrefs=True)),
        "image_coverage": coverage,
        "drawing_count": len(drawings),
        # Table rules are already represented by drawing density. Avoiding the much
        # slower table-layout analyzer keeps repeat builds local and quick.
        "table_count": 0,
    }


def classify(metrics: dict[str, Any]) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if metrics["word_count"] < 20:
        reasons.append("little_or_no_embedded_text")
    if metrics["image_coverage"] >= 0.05:
        reasons.append("substantial_raster_content")
    if metrics["table_count"] > 0:
        reasons.append("detected_table")
    if metrics["drawing_count"] >= 40:
        reasons.append("dense_vector_diagram_or_rules")
    if metrics["text_block_count"] >= 18:
        reasons.append("multi_block_layout")
    return ("complex", reasons) if reasons else ("text_only", [])


def clean_text(text: str) -> str:
    replacements = {
        "\u00a0": " ",
        "\u00ad": "",
        "â€Š": " ",
        "â€‰": " ",
        "â€‘": "-",
        "â€“": "–",
        "â€”": "—",
        "â€™": "’",
        "â€œ": "“",
        "â€": "”",
        "Â®": "®",
        "Â°": "°",
        "Â·": "·",
        "â€¢": "•",
    }
    for damaged, repaired in replacements.items():
        text = text.replace(damaged, repaired)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def markdown_from_page(page: fitz.Page) -> str:
    page_dict = page.get_text("dict", sort=True)
    spans = [
        span
        for block in page_dict.get("blocks", [])
        if block.get("type") == 0
        for line in block.get("lines", [])
        for span in line.get("spans", [])
        if clean_text(span.get("text", ""))
    ]
    body_sizes = [float(span.get("size", 0)) for span in spans if float(span.get("size", 0)) >= 7]
    body_size = median(body_sizes) if body_sizes else 10.0
    output: list[str] = []

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        block_lines: list[str] = []
        for line in block.get("lines", []):
            line_spans = line.get("spans", [])
            text = clean_text("".join(span.get("text", "") for span in line_spans))
            if not text:
                continue
            max_size = max((float(span.get("size", 0)) for span in line_spans), default=body_size)
            is_bold = any("bold" in span.get("font", "").lower() for span in line_spans)
            if len(text) <= 120 and max_size >= body_size * 1.55:
                text = f"## {text}"
            elif len(text) <= 120 and (max_size >= body_size * 1.25 or is_bold):
                text = f"### {text}"
            elif re.match(r"^[•·▪◦]", text):
                text = "- " + re.sub(r"^[•·▪◦]\s*", "", text)
            block_lines.append(text)
        if block_lines:
            output.append("\n".join(block_lines))

    markdown = "\n\n".join(output)
    # Some manuals encode the bullet glyph in its own span/block. Join that
    # marker to the following text so generated Markdown never contains `- `.
    markdown = re.sub(r"(?m)^-\s*\n(?=\S)", "- ", markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown.strip()


def crop_whitespace(image: Image.Image, padding: int = 24) -> Image.Image:
    """Crop near-white margins while preserving a small context border."""
    gray = ImageOps.grayscale(image)
    ink = gray.point(lambda value: 255 if value < 245 else 0)
    bbox = ink.getbbox()
    if not bbox:
        return image.copy()
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    return image.crop((left, top, right, bottom))


def render_page(page: fitz.Page, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    pixmap = page.get_pixmap(dpi=RENDER_DPI, alpha=False, colorspace=fitz.csRGB)
    pixmap.save(destination)
    detail_path = destination.with_name(f"{destination.stem}-detail.png")
    with Image.open(destination) as full:
        detail = crop_whitespace(full.convert("RGB"))
        detail.save(detail_path, "PNG", optimize=True)
    return detail_path


def ocr_image(path: Path) -> tuple[str, list[dict[str, Any]]]:
    """Run local OCR and return reading-order text plus confidence-bearing records."""
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        _OCR_ENGINE = RapidOCR()
    result, _ = _OCR_ENGINE(str(path))
    if not result:
        return "", []
    records = [
        {
            "box": [[round(float(x), 2), round(float(y), 2)] for x, y in item[0]],
            "text": clean_text(str(item[1])),
            "confidence": round(float(item[2]), 4),
        }
        for item in result
        if clean_text(str(item[1])) and float(item[2]) >= 0.45
    ]
    records.sort(key=lambda item: (min(point[1] for point in item["box"]), min(point[0] for point in item["box"])))
    return "\n".join(item["text"] for item in records), records


def cached_ocr(image_path: Path, text_path: Path, records_path: Path) -> tuple[str, list[dict[str, Any]]]:
    """Reuse OCR only when the exact rendered image hash matches the cache."""
    image_hash = sha256(image_path)
    if records_path.exists():
        cached = json.loads(records_path.read_text(encoding="utf-8"))
        if isinstance(cached, dict) and cached.get("image_sha256") == image_hash:
            records = cached.get("records", [])
            text = "\n".join(clean_text(str(item["text"])) for item in records)
            text_path.write_text(text + ("\n" if text else ""), encoding="utf-8", newline="\n")
            return text, records
    text, records = ocr_image(image_path)
    text_path.write_text(text + ("\n" if text else ""), encoding="utf-8", newline="\n")
    records_path.write_text(
        stable_json({"image_sha256": image_hash, "records": records}), encoding="utf-8", newline="\n"
    )
    return text, records


def format_visual_review(review: dict[str, Any] | None) -> str:
    if not review:
        return "Visual review pending."
    notes = review.get("notes", [])
    if isinstance(notes, str):
        notes = [notes]
    lines = [f"- {clean_text(str(note))}" for note in notes if clean_text(str(note))]
    return "\n".join(lines) if lines else "Visual review completed; no additional content found."


def make_contact_sheet(paths: list[tuple[int, Path]], destination: Path) -> None:
    if not paths:
        return
    thumb_width = 320
    label_height = 30
    columns = 3
    prepared: list[tuple[int, Image.Image]] = []
    for page_number, path in paths:
        with Image.open(path) as source:
            image = source.convert("RGB")
            height = max(1, round(image.height * thumb_width / image.width))
            prepared.append((page_number, image.resize((thumb_width, height))))
    cell_height = max(image.height for _, image in prepared) + label_height
    rows = math.ceil(len(prepared) / columns)
    sheet = Image.new("RGB", (columns * thumb_width, rows * cell_height), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (page_number, image) in enumerate(prepared):
        x = (index % columns) * thumb_width
        y = (index // columns) * cell_height
        draw.text((x + 8, y + 8), f"PDF page {page_number}", fill="black", font=font)
        sheet.paste(image, (x, y + label_height))
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, "PNG", optimize=True)


def process_pdf(path: Path, overrides: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    document_slug = slug(path)
    page_dir = OUTPUT_DIR / "pages" / document_slug
    render_dir = OUTPUT_DIR / "renders" / document_slug
    page_dir.mkdir(parents=True, exist_ok=True)
    render_dir.mkdir(parents=True, exist_ok=True)
    document_overrides = overrides.get("documents", {}).get(path.name, {})
    page_overrides = document_overrides.get("pages", {})
    manifest_pages: list[dict[str, Any]] = []
    corpus_sections: list[str] = []
    complex_renders: list[tuple[int, Path]] = []

    with fitz.open(path) as document:
        for page_index, page in enumerate(document):
            page_number = page_index + 1
            metrics = page_metrics(page)
            classification, reasons = classify(metrics)
            review = page_overrides.get(str(page_number))
            markdown = markdown_from_page(page)
            render_path: Path | None = None
            detail_render_path: Path | None = None
            ocr_text = ""
            ocr_records: list[dict[str, Any]] = []
            ocr_text_path: Path | None = None
            ocr_json_path: Path | None = None
            extraction_paths = ["deterministic_text"]

            if classification == "complex":
                extraction_paths.append("rendered_visual_review")
                render_path = render_dir / f"page-{page_number:02d}.png"
                expected_detail = render_path.with_name(f"{render_path.stem}-detail.png")
                source_mtime = path.stat().st_mtime
                if (
                    render_path.exists()
                    and expected_detail.exists()
                    and render_path.stat().st_mtime >= source_mtime
                    and expected_detail.stat().st_mtime >= source_mtime
                ):
                    detail_render_path = expected_detail
                else:
                    detail_render_path = render_page(page, render_path)
                complex_renders.append((page_number, detail_render_path))
                if metrics["word_count"] < OCR_WORD_THRESHOLD:
                    extraction_paths.append("local_ocr")
                    ocr_dir = OUTPUT_DIR / "ocr" / document_slug
                    ocr_dir.mkdir(parents=True, exist_ok=True)
                    ocr_text_path = ocr_dir / f"page-{page_number:02d}.txt"
                    ocr_json_path = ocr_dir / f"page-{page_number:02d}.json"
                    ocr_text, ocr_records = cached_ocr(
                        detail_render_path, ocr_text_path, ocr_json_path
                    )

            page_output = page_dir / f"page-{page_number:02d}.md"
            header = [
                f"# {path.stem} - PDF page {page_number}",
                "",
                f"- Source: `{relative(path)}`",
                f"- Classification: `{classification}`",
                f"- Extraction paths: `{', '.join(extraction_paths)}`",
            ]
            if render_path:
                header.append(f"- Render: `{relative(render_path)}`")
            if detail_render_path:
                header.append(f"- Detail render: `{relative(detail_render_path)}`")
            if ocr_text_path:
                header.append(f"- Local OCR: `{relative(ocr_text_path)}`")
            header.extend(
                [
                    "",
                    "## Deterministic text extraction",
                    "",
                    markdown or "No embedded text was extracted.",
                ]
            )
            if ocr_text_path:
                header.extend(["", "## Local OCR extraction", "", ocr_text or "No OCR text was recognized."])
            if classification == "complex":
                header.extend(["", "## Visual review", "", format_visual_review(review)])
            content = "\n".join(header).rstrip() + "\n"
            page_output.write_text(content, encoding="utf-8", newline="\n")
            corpus_sections.append(content)

            manifest_pages.append(
                {
                    "page": page_number,
                    "classification": classification,
                    "classification_reasons": reasons,
                    "extraction_paths": extraction_paths,
                    "metrics": metrics,
                    "markdown": relative(page_output),
                    "render": relative(render_path) if render_path else None,
                    "detail_render": relative(detail_render_path) if detail_render_path else None,
                    "ocr_text": relative(ocr_text_path) if ocr_text_path else None,
                    "ocr_records": relative(ocr_json_path) if ocr_json_path else None,
                    "ocr_record_count": len(ocr_records),
                    "visual_reviewed": classification == "text_only" or review is not None,
                }
            )

    contact_sheet = OUTPUT_DIR / "validation" / "contact-sheets" / f"{document_slug}.png"
    make_contact_sheet(complex_renders, contact_sheet)
    return (
        {
            "source": relative(path),
            "sha256": sha256(path),
            "page_count": len(manifest_pages),
            "pages": manifest_pages,
            "contact_sheet": relative(contact_sheet) if complex_renders else None,
        },
        corpus_sections,
    )


def process_source_image(path: Path, overrides: dict[str, Any]) -> tuple[dict[str, Any], str]:
    destination = OUTPUT_DIR / "source-images" / f"{path.stem}.png"
    detail_destination = OUTPUT_DIR / "source-images" / f"{path.stem}-detail.png"
    with Image.open(path) as source:
        image = source.convert("RGB")
        width, height = image.size
        source_mtime = path.stat().st_mtime
        if not (
            destination.exists()
            and detail_destination.exists()
            and destination.stat().st_mtime >= source_mtime
            and detail_destination.stat().st_mtime >= source_mtime
        ):
            image.save(destination, "PNG", optimize=True)
            crop_whitespace(image).save(detail_destination, "PNG", optimize=True)
    ocr_dir = OUTPUT_DIR / "ocr" / "source-images"
    ocr_dir.mkdir(parents=True, exist_ok=True)
    ocr_text_path = ocr_dir / f"{path.stem}.txt"
    ocr_json_path = ocr_dir / f"{path.stem}.json"
    ocr_text, ocr_records = cached_ocr(detail_destination, ocr_text_path, ocr_json_path)
    review = overrides.get("source_images", {}).get(path.name)
    page_output = OUTPUT_DIR / "pages" / "source-images" / f"{path.stem}.md"
    page_output.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        [
            f"# Source image - {path.name}",
            "",
            f"- Source: `{relative(path)}`",
            "- Classification: `complex`",
            "- Extraction paths: `local_ocr, rendered_visual_review`",
            f"- Render: `{relative(destination)}`",
            f"- Detail render: `{relative(detail_destination)}`",
            f"- Local OCR: `{relative(ocr_text_path)}`",
            f"- Dimensions: `{width}x{height}`",
            "",
            "## Local OCR extraction",
            "",
            ocr_text or "No OCR text was recognized.",
            "",
            "## Visual review",
            "",
            format_visual_review(review),
            "",
        ]
    )
    page_output.write_text(content, encoding="utf-8", newline="\n")
    return (
        {
            "source": relative(path),
            "sha256": sha256(path),
            "width": width,
            "height": height,
            "render": relative(destination),
            "detail_render": relative(detail_destination),
            "ocr_text": relative(ocr_text_path),
            "ocr_records": relative(ocr_json_path),
            "ocr_record_count": len(ocr_records),
            "markdown": relative(page_output),
            "visual_reviewed": review is not None,
        },
        content,
    )


def find_invalid_structured_sources(
    manifest: dict[str, Any], structured_datasets: dict[str, Any]
) -> list[dict[str, Any]]:
    reviewed_pages = {
        (document["source"], page["page"]): page["visual_reviewed"]
        for document in manifest["documents"]
        for page in document["pages"]
    }
    invalid: list[dict[str, Any]] = []

    def visit(value: Any, dataset: str, path: str) -> None:
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, dataset, f"{path}[{index}]")
            return
        if not isinstance(value, dict):
            return
        if isinstance(value.get("file"), str) and isinstance(value.get("page"), int):
            source = value["file"]
            page = value["page"]
            reviewed = reviewed_pages.get((source, page))
            if reviewed is not True:
                invalid.append(
                    {
                        "dataset": dataset,
                        "path": path,
                        "source": source,
                        "page": page,
                        "reason": "unknown_or_unreviewed_source_page",
                    }
                )
            return
        for key, item in value.items():
            item_path = f"{path}.{key}"
            visit(item, dataset, item_path)

    for dataset, value in structured_datasets.items():
        visit(value, dataset, dataset)
    return invalid


def write_reports(
    manifest: dict[str, Any], overrides: dict[str, Any], structured_datasets: dict[str, Any]
) -> None:
    unresolved: list[dict[str, Any]] = []
    counts = {"text_only": 0, "complex": 0, "visual_reviewed": 0}
    for document in manifest["documents"]:
        for page in document["pages"]:
            counts[page["classification"]] += 1
            if page["visual_reviewed"]:
                counts["visual_reviewed"] += 1
            elif page["classification"] == "complex":
                unresolved.append({"source": document["source"], "page": page["page"]})
    for image in manifest["source_images"]:
        counts["complex"] += 1
        if image["visual_reviewed"]:
            counts["visual_reviewed"] += 1
        else:
            unresolved.append({"source": image["source"], "page": None})

    invalid_structured_sources = find_invalid_structured_sources(manifest, structured_datasets)
    report = {
        "counts": counts,
        "invalid_structured_sources": invalid_structured_sources,
        "unresolved_visual_reviews": unresolved,
        "structured_fact_count": len(overrides.get("structured_facts", [])),
        "structured_setup_count": len(structured_datasets["cable_setups"]),
        "structured_operating_setup_count": len(structured_datasets["operating_setups"]),
        "structured_diagnostic_count": len(structured_datasets["troubleshooting"]),
        "structured_fault_indicator_count": len(structured_datasets["fault_indicators"]),
        "structured_process_profile_count": len(structured_datasets["process_selection"]),
        "structured_power_source_count": len(structured_datasets["power_sources"]),
        "structured_repair_scope_count": len(structured_datasets["repair_scope"]),
        "status": (
            "pass"
            if not unresolved and not invalid_structured_sources
            else "needs_structured_source_review"
            if invalid_structured_sources
            else "needs_visual_review"
        ),
    }
    (OUTPUT_DIR / "validation" / "report.json").write_text(
        stable_json(report), encoding="utf-8", newline="\n"
    )
    report_md = [
        "# Extraction validation report",
        "",
        f"- Status: `{report['status']}`",
        f"- Text-only PDF pages: {counts['text_only']}",
        f"- Complex sources/pages: {counts['complex']}",
        f"- Visually reviewed sources/pages: {counts['visual_reviewed']}",
        f"- Structured facts: {report['structured_fact_count']}",
        f"- Structured cable setups: {report['structured_setup_count']}",
        f"- Structured operating setup sections: {report['structured_operating_setup_count']}",
        f"- Structured diagnostic nodes: {report['structured_diagnostic_count']}",
        f"- Structured fault indicators: {report['structured_fault_indicator_count']}",
        f"- Structured process-selection profiles: {report['structured_process_profile_count']}",
        f"- Structured power-source records: {report['structured_power_source_count']}",
        f"- Structured repair-scope records: {report['structured_repair_scope_count']}",
        "",
        "## Unresolved visual reviews",
        "",
    ]
    if unresolved:
        for item in unresolved:
            suffix = f" PDF page {item['page']}" if item["page"] else ""
            report_md.append(f"- `{item['source']}`{suffix}")
    else:
        report_md.append("None.")
    report_md.extend(["", "## Invalid structured source references", ""])
    if invalid_structured_sources:
        for item in invalid_structured_sources:
            report_md.append(
                f"- `{item['dataset']}` `{item['path']}` -> `{item['source']}` page {item['page']}"
            )
    else:
        report_md.append("None.")
    (OUTPUT_DIR / "validation" / "report.md").write_text(
        "\n".join(report_md).rstrip() + "\n", encoding="utf-8", newline="\n"
    )


def write_readme(manifest: dict[str, Any]) -> None:
    page_count = sum(document["page_count"] for document in manifest["documents"])
    readme = f"""# Generated Vulcan OmniPro 220 knowledge

This directory is generated by `scripts/extract_knowledge.py`. Do not hand-edit it.

## Build

```powershell
python -m venv .venv
.\\.venv\\Scripts\\python.exe -m pip install -r requirements-extraction.txt
.\\.venv\\Scripts\\python.exe scripts\\extract_knowledge.py --require-reviewed
```

## Contents

- `{page_count}` PDF pages from `{len(manifest['documents'])}` documents.
- `{len(manifest['source_images'])}` product images.
- Page Markdown under `pages/`.
- High-resolution complex-page renders under `renders/`.
- Local OCR text and confidence-bearing records under `ocr/`.
- Structured facts under `tables/facts.json`.
- Process cable setups under `setups/cable-setups.json`.
- Process operating setups under `setups/operating-setups.json`.
- Documented display conditions under `fault-indicators.json`.
- Process-selection profiles under `process-selection/chart.json`.
- Power-source requirements under `power/power-sources.json`.
- Repair-scope classifications under `repair/repair-scope.json`.
- Symptom/cause/check/remedy relationships under `troubleshooting/graph.json`.
- Interactive-view hotspot geometry in `hotspots.json`, with `hotspots-overlay.png` as
  its visual check.
- Classification and source hashes in `manifest.json`.
- Visual-review status in `validation/report.md`.

Complex pages always use deterministic text extraction plus rendered visual review. A
`--require-reviewed` build fails while any complex page or image lacks a review entry in
`scripts/extraction_overrides.json`.
"""
    (OUTPUT_DIR / "README.md").write_text(readme, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--require-reviewed",
        action="store_true",
        help="Fail when a complex page or source image has not been visually reviewed.",
    )
    args = parser.parse_args()
    ensure_dirs()
    overrides = load_overrides()
    structured_datasets = {
        "cable_setups": load_structured_knowledge("cable-setups.json"),
        "fault_indicators": load_structured_knowledge("fault-indicators.json"),
        "operating_setups": load_structured_knowledge("operating-setups.json"),
        "process_selection": load_structured_knowledge("process-selection.json"),
        "power_sources": load_structured_knowledge("power-sources.json"),
        "repair_scope": load_structured_knowledge("repair-scope.json"),
        "troubleshooting": load_structured_knowledge("troubleshooting.json"),
        "structured_facts": overrides.get("structured_facts", []),
    }
    manifest: dict[str, Any] = {"documents": [], "source_images": []}
    corpus_sections: list[str] = []

    for path in sorted(FILES_DIR.glob("*.pdf")):
        document_manifest, sections = process_pdf(path, overrides)
        manifest["documents"].append(document_manifest)
        corpus_sections.extend(sections)

    for path in SOURCE_IMAGES:
        image_manifest, section = process_source_image(path, overrides)
        manifest["source_images"].append(image_manifest)
        corpus_sections.append(section)

    # Hotspot geometry runs after the PDFs, because it fits a homography from the page
    # renders those produce onto the product photographs. See scripts/hotspots.py.
    hotspot_data = hotspots.build()
    (OUTPUT_DIR / "hotspots.json").write_text(
        stable_json(hotspot_data), encoding="utf-8", newline="\n"
    )
    hotspots.write_overlay(hotspot_data, OUTPUT_DIR / "hotspots-overlay.png")
    manifest["hotspots"] = [
        {
            "view": name,
            "image": view["image"],
            "source": view["source"],
            "part_count": len(view["parts"]),
            "geometry_method": view["validation"]["method"],
            # Present only where a homography was fitted and validated.
            **(
                {"held_out_error_px": view["validation"]["held_out_error_px"]}
                if "held_out_error_px" in view["validation"]
                else {}
            ),
        }
        for name, view in sorted(hotspot_data["views"].items())
    ]

    (OUTPUT_DIR / "manifest.json").write_text(
        stable_json(manifest), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "corpus.md").write_text(
        "\n\n---\n\n".join(section.rstrip() for section in corpus_sections) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (OUTPUT_DIR / "tables" / "facts.json").write_text(
        stable_json(overrides.get("structured_facts", [])), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "troubleshooting" / "graph.json").write_text(
        stable_json(structured_datasets["troubleshooting"]), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "setups" / "cable-setups.json").write_text(
        stable_json(structured_datasets["cable_setups"]), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "setups" / "operating-setups.json").write_text(
        stable_json(structured_datasets["operating_setups"]), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "fault-indicators.json").write_text(
        stable_json(structured_datasets["fault_indicators"]), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "process-selection" / "chart.json").write_text(
        stable_json(structured_datasets["process_selection"]), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "power" / "power-sources.json").write_text(
        stable_json(structured_datasets["power_sources"]), encoding="utf-8", newline="\n"
    )
    (OUTPUT_DIR / "repair" / "repair-scope.json").write_text(
        stable_json(structured_datasets["repair_scope"]), encoding="utf-8", newline="\n"
    )
    write_reports(manifest, overrides, structured_datasets)
    write_readme(manifest)

    report = json.loads((OUTPUT_DIR / "validation" / "report.json").read_text(encoding="utf-8"))
    print(stable_json(report), end="")
    if args.require_reviewed and report["status"] != "pass":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
