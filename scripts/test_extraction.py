from __future__ import annotations

import json
import unittest

from scripts.extract_knowledge import OUTPUT_DIR, classify, clean_text


class ExtractionTests(unittest.TestCase):
    def test_plain_page_is_text_only(self) -> None:
        classification, reasons = classify(
            {
                "word_count": 250,
                "image_coverage": 0.0,
                "table_count": 0,
                "drawing_count": 2,
                "text_block_count": 4,
            }
        )
        self.assertEqual("text_only", classification)
        self.assertEqual([], reasons)

    def test_diagram_page_is_complex(self) -> None:
        classification, reasons = classify(
            {
                "word_count": 80,
                "image_coverage": 0.0,
                "table_count": 0,
                "drawing_count": 75,
                "text_block_count": 8,
            }
        )
        self.assertEqual("complex", classification)
        self.assertIn("dense_vector_diagram_or_rules", reasons)

    def test_mojibake_is_normalized(self) -> None:
        self.assertEqual("Owner’s 120 VAC – 140 A", clean_text("Ownerâ€™s 120â€ŠVAC â€“ 140â€ŠA"))

    def test_generated_corpus_passes_provenance_gate(self) -> None:
        report = json.loads((OUTPUT_DIR / "validation" / "report.json").read_text(encoding="utf-8"))
        self.assertEqual("pass", report["status"])
        self.assertEqual([], report["unresolved_visual_reviews"])
        self.assertGreaterEqual(report["structured_fact_count"], 15)
        self.assertEqual(4, report["structured_process_profile_count"])
        self.assertEqual(1, report["structured_power_source_count"])
        self.assertEqual(3, report["structured_repair_scope_count"])

    def test_manifest_covers_every_input(self) -> None:
        manifest = json.loads((OUTPUT_DIR / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(3, len(manifest["documents"]))
        self.assertEqual(51, sum(item["page_count"] for item in manifest["documents"]))
        self.assertEqual(3, len(manifest["source_images"]))


if __name__ == "__main__":
    unittest.main()
