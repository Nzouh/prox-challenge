"""Derive hotspot geometry for the interactive manual views.

The owner's manual pages 8 and 9 are orthographic line drawings whose leader lines
already name and locate every control. Deterministic text extraction destroys that
geometry -- it yields a pile of disconnected label fragments -- so this script recovers
it: it fits a planar homography from the page render to the matching product photograph
and carries the drawing's callout anchors into photo space.

The photographs' pixels are never resampled. Only coordinates are transformed, so each
hotspot canvas keeps the original image quality and the geometry still traces to the
manual page.

Not every part can be projected. The control panel carries features spread in two
dimensions, so its homography is well conditioned and is validated against a held-out
point. The bottom socket strip does not: its features are collinear, and four collinear
correspondences cannot determine a homography (the x-scale collapses to ~0.02). Those
parts are measured directly in the photograph instead, which is exact and needs no
transform. Every part records which method produced it -- they are different provenance
claims and must not be presented as one.

Views are independent. There is no shared coordinate space between front and inside and
no morph between them, so each view is a self-contained image plus part list.

Run:  python scripts/hotspots.py --check
      python scripts/hotspots.py --overlay
"""

from __future__ import annotations

import argparse
import json
from itertools import combinations
from pathlib import Path
from typing import Any

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "knowledge" / "hotspots.json"

FRONT_PHOTO = ROOT / "product-front.webp"
FRONT_DRAWING = ROOT / "knowledge" / "renders" / "owner-manual" / "page-08-detail.png"
FRONT_PAGE = 8
SOURCE_FILE = "files/owner-manual.pdf"

# Largest acceptable held-out reprojection error, in photo pixels. A knob is ~26px in
# radius here, so anything beyond this would start to shift a hotspot off its control.
MAX_HELD_OUT_ERROR_PX = 8.0

# The photographs are 1200px wide in a ~712px column, so one source pixel covers 0.59
# display pixels at rest: 1:1 lands near 1.7x and twice native -- the practical limit
# before softening shows -- near 3.4x. Zoom is capped just under that.
MAX_ZOOM = 3.4
MIN_ZOOM = 1.4
# Fraction of the viewport a focused part should occupy at rest.
ZOOM_TARGET_FRACTION = 0.35
# A region frames a whole area rather than one control, so it fills much more of the view.
REGION_TARGET_FRACTION = 0.9

# Correspondences on the control-panel plane: (label, page-08 xy, photo xy).
# HOME/BACK from grey-blob centroids in the render; knob centres from Hough circles;
# photo button centres read from 6x zoom crops. HOME/BACK are symmetric about x=923.6 in
# the drawing and x=596.0 in the photo, against knob midpoints of 922.5 and 595.5 -- an
# independent check that the pairs are correctly matched.
PANEL_CORRESPONDENCES: list[tuple[str, tuple[float, float], tuple[float, float]]] = [
    ("home_button", (655.2, 734.2), (423.3, 478.3)),
    ("back_button", (1192.1, 734.1), (768.8, 476.7)),
    ("left_knob", (715.0, 922.0), (464.0, 598.0)),
    ("control_knob", (926.0, 929.0), (595.0, 597.0)),
    ("right_knob", (1130.0, 919.0), (727.0, 596.0)),
]
PANEL_HELD_OUT = "control_knob"

# Anchors projected from page 8 through the validated panel homography.
FRONT_PROJECTED: dict[str, tuple[float, float]] = {
    "home_button": (655.2, 734.2),
    "back_button": (1192.1, 734.1),
    "left_knob": (715.0, 922.0),
    "control_knob": (926.0, 929.0),
    "right_knob": (1130.0, 919.0),
    "lcd_display": (924.0, 720.0),
}

# Anchors measured directly in the photograph: the socket strip (projection degenerate)
# and the lower front face (no well-conditioned correspondence set).
#   brass sockets: HSV colour centroids, sub-pixel and unambiguous
#   others: read from high-zoom crops
FRONT_MEASURED: dict[str, tuple[float, float]] = {
    "spool_gun_gas_outlet": (481.8, 965.2),
    "negative_socket": (602.2, 968.8),
    "positive_socket": (771.2, 964.7),
    "wire_feed_power_cable": (684.0, 990.0),
    "power_switch": (563.0, 822.0),
    "mig_gun_spool_gun_cable_socket": (421.7, 781.0),
}

# Hit regions in photo pixels. Circles are generous enough to be comfortable click and
# touch targets while staying clear of their neighbours -- the build asserts no overlap.
# Measured extents: knobs r=26/38/28, brass inserts r~24 (full socket assembly r~33).
FRONT_SHAPES: dict[str, dict[str, Any]] = {
    "home_button": {"type": "circle", "r": 28.0},
    "back_button": {"type": "circle", "r": 28.0},
    "left_knob": {"type": "circle", "r": 32.0},
    "control_knob": {"type": "circle", "r": 44.0},
    "right_knob": {"type": "circle", "r": 32.0},
    "lcd_display": {"type": "rect", "w": 256.0, "h": 164.0},
    "spool_gun_gas_outlet": {"type": "circle", "r": 32.0},
    "negative_socket": {"type": "circle", "r": 32.0},
    "positive_socket": {"type": "circle", "r": 32.0},
    "wire_feed_power_cable": {"type": "circle", "r": 26.0},
    "power_switch": {"type": "rect", "w": 63.0, "h": 65.0},
    "mig_gun_spool_gun_cable_socket": {"type": "rect", "w": 44.0, "h": 34.0},
}

# One-line use-case descriptions, each with its own provenance.
#
# Page 8 names these parts but never defines them, so most descriptions are derived from
# the procedures elsewhere in the manual that operate the part -- tier 3, with the pages
# the derivation rests on cited as basis. Where the manual states a function outright
# ("Press Back Button to return to the previous screen"), the description is tier 1 and
# cites that page. The distinction is real and the UI renders it.
QSG_FILE = "files/quick-start-guide.pdf"


def _t1(page: int, file: str = SOURCE_FILE) -> dict[str, Any]:
    return {"tier": 1, "source": file, "page": page}


def _t3(basis: str) -> dict[str, Any]:
    return {"tier": 3, "source": "inference", "basis": basis}


DESCRIPTIONS: dict[str, tuple[str, dict[str, Any]]] = {
    "home_button": (
        "Returns the display to the process-selection screen. Every setup procedure in "
        "the manual starts by pressing it before choosing MIG, Flux-Cored, TIG or Stick.",
        _t3("owner-manual.pdf pp. 20, 30, 32"),
    ),
    "back_button": (
        "Returns to the previous screen without changing the current setting.",
        _t1(20),
    ),
    "control_knob": (
        "Turn it to move through processes and settings; press it to select one and go "
        "to the next screen.",
        _t1(20),
    ),
    "left_knob": (
        "Sets the left-hand value on whichever screen is showing -- wire or electrode "
        "diameter during setup, then wire feed speed (amperage) while welding.",
        _t3("owner-manual.pdf pp. 20, 30, 32"),
    ),
    "right_knob": (
        "Sets the right-hand value -- material thickness during setup, then voltage "
        "while welding. In TIG it also switches the torch on.",
        _t3("owner-manual.pdf pp. 20, 30"),
    ),
    "lcd_display": (
        "Shows the selected process and its settings, and displays the warning screen "
        "if the welder overheats and shuts itself down.",
        _t3("owner-manual.pdf pp. 19, 20"),
    ),
    "power_switch": (
        "Switches the welder on and off. The manual requires it OFF and the welder "
        "unplugged before any setup, wire change or maintenance.",
        _t3("owner-manual.pdf pp. 10, 16, 17"),
    ),
    "mig_gun_spool_gun_cable_socket": (
        "Pass-through for the MIG or spool gun cable. The connector goes through here "
        "and locks into the wire feed inside; if it is not fully seated the gas "
        "connection leaks and shielding gas will not reach the weld.",
        _t3("owner-manual.pdf pp. 13, 17"),
    ),
    "spool_gun_gas_outlet": (
        "Shielding gas connection for an optional spool gun, used only when one is "
        "fitted -- its gas hose connects here rather than to the regulator.",
        _t1(17),
    ),
    "negative_socket": (
        "One of the two output terminals. What belongs here changes with the process: "
        "ground clamp for MIG and Stick, wire feed power for Flux-Cored, torch for TIG.",
        _t3("quick-start-guide.pdf p. 2; owner-manual.pdf p. 13"),
    ),
    "positive_socket": (
        "The other output terminal, and its role also changes with the process: wire "
        "feed power for MIG, electrode holder for Stick, ground clamp for Flux-Cored "
        "and TIG.",
        _t3("quick-start-guide.pdf p. 2; owner-manual.pdf p. 13"),
    ),
    "wire_feed_power_cable": (
        "Short lead that powers the wire feed. It plugs into whichever output socket "
        "the process calls for -- positive for MIG, negative for Flux-Cored -- and "
        "twists clockwise to lock.",
        _t3("quick-start-guide.pdf p. 2; owner-manual.pdf p. 13"),
    ),
    # --- interior (page 9) ---
    "wire_spool": (
        "Holds the welding wire. The wire size is marked on the spool and the feed roller "
        "has to be set to match it. Takes a 2 lb spool, or 10-12 lb with the adapter.",
        _t3("owner-manual.pdf p. 12; quick-start-guide.pdf p. 1"),
    ),
    "spool_knob": (
        "Screws into the spool adapter to hold the spool on its spindle. Unscrewing it is "
        "the first step in changing wire.",
        _t3("owner-manual.pdf p. 11; quick-start-guide.pdf p. 1"),
    ),
    "wire_feed_mechanism": (
        "Drives wire from the spool out to the gun. The gun cable connector plugs into "
        "the socket on this assembly, and the tensioner, idler arm and feed roller all "
        "sit on it.",
        _t3("owner-manual.pdf pp. 13, 15"),
    ),
    "feed_tensioner": (
        "Sets how hard the roller grips the wire -- the manual calls for 3-5 on solid "
        "wire and 2-3 on flux-cored, which is softer and crushes if overtightened. "
        "Loosening it releases the idler arm.",
        _t3("owner-manual.pdf pp. 11, 15, 16"),
    ),
    "idler_arm": (
        "Spring-loaded arm that presses the wire onto the feed roller. It swings up when "
        "the tensioner is released, and is pushed back down to seat new wire.",
        _t3("owner-manual.pdf pp. 11, 15"),
    ),
    "feed_roller_knob": (
        "Unscrews to release the feed roller. The roller must suit the wire type and be "
        "turned so its groove matches the wire size marked on the spool.",
        _t3("owner-manual.pdf p. 12"),
    ),
    "wire_inlet_liner": (
        "Guides wire from the spool into the feed mechanism. Wire passes through it and "
        "the feed guide before reaching the roller.",
        _t3("owner-manual.pdf p. 15"),
    ),
    "cold_wire_feed_switch": (
        "Feeds wire through the gun for loading without striking an arc. The manual has "
        "you hold it until two inches of wire have fed through, with the gun pointed "
        "away from everything.",
        _t1(16),
    ),
    "foot_pedal_socket": (
        "Where the TIG foot pedal plugs in, inside the machine. TIG only.",
        _t3("quick-start-guide.pdf p. 2; owner-manual.pdf p. 9"),
    ),
    "wire_feed_control_socket": (
        "The wire feed control cable plugs in here and tightens with a lock ring. The "
        "plug fits one orientation only.",
        _t1(13),
    ),
}

INSIDE_PHOTO = ROOT / "product-inside.webp"
INSIDE_DRAWING = ROOT / "knowledge" / "renders" / "owner-manual" / "page-09-detail.png"
INSIDE_PAGE = 9

# The canvas is the whole product shot. The interior occupies about a fifth of it, so the
# bay is offered as a click-to-zoom region: click it to frame the interior, then the parts
# inside are at a workable size. The manual never names this compartment -- page 10 calls
# the panel over it "the Door" -- so it is a viewport affordance, not a machine part, and
# is kept out of the part vocabulary entirely.
INSIDE_REGIONS: dict[str, dict[str, Any]] = {
    "interior": {
        "label": "Interior",
        "center": (655.0, 805.0),
        "shape": {"type": "rect", "w": 590.0, "h": 420.0},
    },
}

# Every interior part is measured directly in the photograph. Projection from page 9 was
# tested and rejected on evidence: local scale is not constant across the scene (the spool
# radius maps at 0.658, spool-to-feed-roller distance at 0.721, spool-to-cold-switch at
# 0.779), and the spool knob sits 34px below the centre of its own concentric disc -- both
# signatures of parts at different depths, which no single plane models. The identifiable
# features also cluster in a near-vertical band, the same degeneracy that defeated the
# front socket strip. Photo measurement is exact and needs no transform.
#
# Two close-range photographs of the real machine were used to confirm identity, not
# position: they established that the cold wire feed control is a rounded rocker rather
# than the circle it resembles at this scale, that the idler arm is the VULCAN-embossed
# lever sitting above the feed roller knob, and that the coiled inlet liner is the
# rod-like run between spool and casting. This view is also the better-conditioned one --
# the spool projects as a true circle here (semi-axes 75.5 x 75.5), where in the close
# photographs it is a marked ellipse.
INSIDE_MEASURED: dict[str, tuple[float, float]] = {
    "wire_spool": (489.0, 830.0),
    "spool_knob": (481.0, 864.0),
    "wire_feed_mechanism": (796.0, 826.0),
    "feed_tensioner": (782.0, 755.0),
    "idler_arm": (808.0, 816.0),
    "feed_roller_knob": (790.0, 862.0),
    "wire_inlet_liner": (676.0, 799.0),
    "cold_wire_feed_switch": (782.0, 656.0),
    "foot_pedal_socket": (804.0, 954.0),
    "wire_feed_control_socket": (847.0, 948.0),
}

# Parts that sit bodily inside another part. Children are painted and hit-tested last, so
# clicking a knob selects the knob rather than the casting it is bolted to; the overlap
# check only applies between peers.
INSIDE_PARENTS: dict[str, str] = {
    "spool_knob": "wire_spool",
    "feed_tensioner": "wire_feed_mechanism",
    "idler_arm": "wire_feed_mechanism",
    "feed_roller_knob": "wire_feed_mechanism",
}

# Parts whose position could not be observed directly and was inferred from a nearby
# landmark. Recorded so the weaker placement is visible rather than implied.
INSIDE_GEOMETRY_NOTES: dict[str, str] = {
    "wire_feed_control_socket": (
        "Hidden in this view by the control cable plugged into it; placed from the panel "
        "pictogram printed directly beneath the socket, and confirmed against a "
        "close-range photograph of the same bay."
    ),
}

INSIDE_SHAPES: dict[str, dict[str, Any]] = {
    "wire_spool": {"type": "circle", "r": 76.0},
    "spool_knob": {"type": "circle", "r": 40.0},
    # The feed casting is a tilted plate; a quad tracks it far better than a box.
    "wire_feed_mechanism": {
        "type": "polygon",
        "points": [(699.0, 742.0), (895.0, 792.0), (871.0, 906.0), (702.0, 866.0)],
    },
    # A knurled cylinder standing on end: 51px across against 68px tall, so a circle
    # leaves its top and bottom uncovered.
    "feed_tensioner": {"type": "ellipse", "rx": 26.0, "ry": 35.0},
    # The VULCAN-embossed boss on the lever, wider than it is tall.
    "idler_arm": {"type": "ellipse", "rx": 24.0, "ry": 18.0},
    "feed_roller_knob": {"type": "circle", "r": 22.0},
    # The exposed run of coiled liner between spool and casting. It falls left-to-right
    # -- the earlier quad sloped the wrong way -- and stops short of the casting edge,
    # which sits at x~700 at this height.
    "wire_inlet_liner": {
        "type": "polygon",
        "points": [(655.0, 785.0), (691.0, 797.0), (697.0, 813.0), (661.0, 800.0)],
    },
    # A rounded rocker, not a circle -- confirmed on the close-range photographs.
    "cold_wire_feed_switch": {"type": "rect", "w": 22.0, "h": 26.0},
    "foot_pedal_socket": {"type": "circle", "r": 14.0},
    "wire_feed_control_socket": {"type": "circle", "r": 15.0},
}

PAGE_09_LABELS: dict[str, str] = {
    "wire_spool": "Wire Spool",
    "spool_knob": "Spool Knob",
    "wire_feed_mechanism": "Wire Feed Mechanism",
    "feed_tensioner": "Feed Tensioner",
    "idler_arm": "Idler Arm",
    "feed_roller_knob": "Feed Roller Knob",
    "wire_inlet_liner": "Wire Inlet Liner",
    "cold_wire_feed_switch": "Cold Wire Feed Switch",
    "foot_pedal_socket": "Foot Pedal Socket",
    "wire_feed_control_socket": "Wire Feed Control Socket",
}


# The label vocabulary page 8 actually prints. A part name outside this set is a bug:
# the hotspot layer may only name controls the manual names.
PAGE_08_LABELS: dict[str, str] = {
    "home_button": "Home Button",
    "back_button": "Back Button",
    "control_knob": "Control Knob",
    "left_knob": "Left Knob",
    "right_knob": "Right Knob",
    "lcd_display": "LCD Display",
    "power_switch": "Power Switch",
    "storage_compartment": "Storage Compartment",
    "mig_gun_spool_gun_cable_socket": "MIG Gun / Spool Gun Cable Socket",
    "spool_gun_gas_outlet": "Spool Gun Gas Outlet",
    "negative_socket": "Negative Socket",
    "positive_socket": "Positive Socket",
    "wire_feed_power_cable": "Wire Feed Power Cable",
}


def project(homography: np.ndarray, points: list[tuple[float, float]]) -> np.ndarray:
    return cv2.perspectiveTransform(np.array([points], dtype=np.float32), homography)[0]


def fit_panel_homography() -> tuple[np.ndarray, dict[str, float]]:
    """Fit the control-panel homography, holding one point out to measure it."""
    fit = [c for c in PANEL_CORRESPONDENCES if c[0] != PANEL_HELD_OUT]
    src = np.array([c[1] for c in fit], dtype=np.float32)
    dst = np.array([c[2] for c in fit], dtype=np.float32)
    homography = cv2.getPerspectiveTransform(src, dst)
    errors = {
        label: float(np.hypot(*(project(homography, [drawing])[0] - np.array(photo))))
        for label, drawing, photo in PANEL_CORRESPONDENCES
    }
    return homography, errors


def zoom_for(shape: dict[str, Any], width: int) -> float:
    """Zoom that makes the part occupy ZOOM_TARGET_FRACTION of the viewport."""
    if shape["type"] == "circle":
        extent = shape["r"] * 2
    elif shape["type"] == "ellipse":
        extent = max(shape["rx"], shape["ry"]) * 2
    elif shape["type"] == "rect":
        extent = max(shape["w"], shape["h"])
    else:
        xs = [x for x, _ in shape["points"]]
        ys = [y for _, y in shape["points"]]
        extent = max(max(xs) - min(xs), max(ys) - min(ys))
    desired = ZOOM_TARGET_FRACTION / (extent / width)
    return round(min(MAX_ZOOM, max(MIN_ZOOM, desired)), 3)


def raw_box(name: str, xy: tuple[float, float], shapes: dict[str, dict[str, Any]]):
    """Bounding box of a hit region, in photo pixels."""
    x, y = xy
    s = shapes[name]
    if s["type"] == "circle":
        r = s["r"]
        return x - r, y - r, x + r, y + r
    if s["type"] == "ellipse":
        return x - s["rx"], y - s["ry"], x + s["rx"], y + s["ry"]
    if s["type"] == "rect":
        w, h = s["w"] / 2, s["h"] / 2
        return x - w, y - h, x + w, y + h
    xs = [px for px, _ in s["points"]]
    ys = [py for _, py in s["points"]]
    return min(xs), min(ys), max(xs), max(ys)


def assert_no_peer_overlap(
    anchors: dict[str, tuple[float, float]],
    shapes: dict[str, dict[str, Any]],
    parents: dict[str, str],
) -> None:
    """Overlapping hit regions make a click ambiguous -- but only between peers.

    A knob bolted to a casting is *meant* to sit inside it. Nesting is declared, the child
    is hit-tested first, and only siblings under the same parent are required to be
    disjoint.
    """
    for a, b in combinations(sorted(anchors), 2):
        if parents.get(a) != parents.get(b):
            continue  # different levels: nesting is intentional
        ax0, ay0, ax1, ay1 = raw_box(a, anchors[a], shapes)
        bx0, by0, bx1, by1 = raw_box(b, anchors[b], shapes)
        if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
            raise SystemExit(f"Peer hit regions overlap: {a} and {b}")


def _part(
    name: str,
    xy: tuple[float, float],
    method: str,
    width: int,
    height: int,
    shapes: dict[str, dict[str, Any]],
    labels: dict[str, str],
    page: int,
    parents: dict[str, str],
    notes: dict[str, str],
    offset: tuple[float, float],
) -> dict[str, Any]:
    ox, oy = offset
    x, y = xy[0] - ox, xy[1] - oy
    raw = shapes[name]
    if name not in DESCRIPTIONS:
        raise SystemExit(f"No description written for part: {name}")
    description, description_provenance = DESCRIPTIONS[name]

    if raw["type"] == "circle":
        shape: dict[str, Any] = {"type": "circle", "r": round(raw["r"] / width, 5)}
    elif raw["type"] == "ellipse":
        shape = {
            "type": "ellipse",
            "rx": round(raw["rx"] / width, 5),
            "ry": round(raw["ry"] / height, 5),
        }
    elif raw["type"] == "rect":
        shape = {
            "type": "rect",
            "w": round(raw["w"] / width, 5),
            "h": round(raw["h"] / height, 5),
        }
    else:
        shape = {
            "type": "polygon",
            "points": [
                {"x": round((px - ox) / width, 5), "y": round((py - oy) / height, 5)}
                for px, py in raw["points"]
            ],
        }

    part: dict[str, Any] = {
        "id": name,
        "label": labels[name],
        # Normalised to the image box: x and w by width, y and h by height, circle r by
        # width. The renderer positions by percentage inside an object-fit: contain box.
        "center": {"x": round(x / width, 5), "y": round(y / height, 5)},
        "center_px": {"x": round(x, 1), "y": round(y, 1)},
        "shape": shape,
        "zoom": zoom_for(raw, width),
        # "projected" traces to a page callout through the validated homography;
        # "measured" was located in the photograph. Different provenance claims.
        "geometry_method": method,
        # Provenance of the part's NAME and LOCATION -- always the callout page.
        "provenance": {"tier": 1, "source": SOURCE_FILE, "page": page},
        "description": description,
        # Provenance of the DESCRIPTION, which is a separate claim from the name.
        "description_provenance": description_provenance,
    }
    if name in parents:
        part["parent"] = parents[name]
    if name in notes:
        part["geometry_note"] = notes[name]
    return part


def _view(
    photo_path: Path,
    page: int,
    anchors: list[tuple[str, tuple[float, float], str]],
    shapes: dict[str, dict[str, Any]],
    labels: dict[str, str],
    parents: dict[str, str],
    notes: dict[str, str],
    validation: dict[str, Any],
    regions: dict[str, dict[str, Any]] | None = None,
    crop: tuple[int, int, int, int] | None = None,
    canvas_path: Path | None = None,
) -> dict[str, Any]:
    regions = regions or {}
    photo = cv2.imread(str(photo_path))
    if photo is None:
        raise SystemExit(f"Cannot read {photo_path}")

    offset = (0.0, 0.0)
    image_name = photo_path.name
    crop_record: dict[str, Any] | None = None
    if crop is not None:
        x0, y0, x1, y1 = crop
        # Same pixels as the source, just framed on the parts -- nothing is resampled.
        canvas = photo[y0:y1, x0:x1]
        if canvas_path is not None:
            canvas_path.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(canvas_path), canvas)
            image_name = canvas_path.relative_to(ROOT).as_posix()
        photo = canvas
        offset = (float(x0), float(y0))
        crop_record = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}

    height, width = photo.shape[:2]

    unknown = sorted({name for name, _, _ in anchors} - set(labels))
    if unknown:
        raise SystemExit(f"Parts not named on page {page}: {unknown}")
    assert_no_peer_overlap({n: xy for n, xy, _ in anchors}, shapes, parents)

    parts = [
        _part(n, xy, m, width, height, shapes, labels, page, parents, notes, offset)
        for n, xy, m in anchors
    ]
    parts.sort(key=lambda part: part["id"])
    view: dict[str, Any] = {
        "image": image_name,
        "regions": [
            {
                "id": rid,
                "label": r["label"],
                "center": {
                    "x": round((r["center"][0] - offset[0]) / width, 5),
                    "y": round((r["center"][1] - offset[1]) / height, 5),
                },
                "center_px": {
                    "x": round(r["center"][0] - offset[0], 1),
                    "y": round(r["center"][1] - offset[1], 1),
                },
                "shape": {
                    "type": "rect",
                    "w": round(r["shape"]["w"] / width, 5),
                    "h": round(r["shape"]["h"] / height, 5),
                },
                "zoom": round(
                    min(
                        MAX_ZOOM,
                        REGION_TARGET_FRACTION
                        / (max(r["shape"]["w"], r["shape"]["h"]) / width),
                    ),
                    3,
                ),
            }
            for rid, r in sorted(regions.items())
        ],
        "size": {"width": width, "height": height},
        "source": {"file": SOURCE_FILE, "page": page},
        "validation": validation,
        "parts": parts,
    }
    if crop_record is not None:
        # The canvas is a crop of a corpus source image, not a new photograph.
        view["source_image"] = photo_path.name
        view["crop"] = crop_record
    return view


def build_front() -> dict[str, Any]:
    homography, errors = fit_panel_homography()
    held_out = errors[PANEL_HELD_OUT]
    if held_out > MAX_HELD_OUT_ERROR_PX:
        raise SystemExit(
            f"Panel homography failed validation: held-out {PANEL_HELD_OUT} error "
            f"{held_out:.2f}px exceeds {MAX_HELD_OUT_ERROR_PX}px."
        )

    anchors: list[tuple[str, tuple[float, float], str]] = []
    for name, drawing_xy in FRONT_PROJECTED.items():
        x, y = project(homography, [drawing_xy])[0]
        anchors.append((name, (float(x), float(y)), "projected"))
    for name, xy in FRONT_MEASURED.items():
        anchors.append((name, xy, "measured"))

    return _view(
        FRONT_PHOTO,
        FRONT_PAGE,
        anchors,
        FRONT_SHAPES,
        PAGE_08_LABELS,
        {},
        {},
        {
            "method": "homography from page 8, validated against a held-out point",
            "held_out_point": PANEL_HELD_OUT,
            "held_out_error_px": round(held_out, 2),
            "errors_px": {k: round(v, 2) for k, v in sorted(errors.items())},
        },
    )


def build_inside() -> dict[str, Any]:
    anchors = [(name, xy, "measured") for name, xy in INSIDE_MEASURED.items()]
    return _view(
        INSIDE_PHOTO,
        INSIDE_PAGE,
        anchors,
        INSIDE_SHAPES,
        PAGE_09_LABELS,
        INSIDE_PARENTS,
        INSIDE_GEOMETRY_NOTES,
        {
            "method": "measured directly in the photograph; page-9 projection rejected",
            "projection_rejected_because": (
                "local scale is not constant (spool radius 0.658, spool-to-roller 0.721, "
                "spool-to-cold-switch 0.779) and the spool knob sits 34px off its own "
                "disc centre -- parts lie at different depths, and the identifiable "
                "features are near-collinear"
            ),
        },
        regions=INSIDE_REGIONS,
    )


def build() -> dict[str, Any]:
    # Views are independent: separate images, separate coordinate spaces, no morph.
    return {"views": {"front": build_front(), "inside": build_inside()}}


def write_overlay(data: dict[str, Any], destination: Path) -> list[Path]:
    """Draw every hit region on its photograph so the geometry can be checked by eye.

    Yellow was projected from the manual page; green was measured in the photograph;
    nested children are drawn thinner so they read as sitting inside their parent.
    One file per view -- they are different images.
    """
    written: list[Path] = []
    for name, view in sorted(data["views"].items()):
        photo = cv2.imread(str(ROOT / view["image"]))
        if photo is None:
            continue
        w, h = view["size"]["width"], view["size"]["height"]
        # Parents first, children over them, matching the hit-test order.
        for part in sorted(view["parts"], key=lambda pt: "parent" in pt):
            cx, cy = part["center_px"]["x"], part["center_px"]["y"]
            colour = (0, 255, 255) if part["geometry_method"] == "projected" else (0, 200, 0)
            thickness = 1 if "parent" in part else 2
            shape = part["shape"]
            if shape["type"] == "circle":
                cv2.circle(photo, (int(cx), int(cy)), int(shape["r"] * w), colour, thickness)
            elif shape["type"] == "ellipse":
                cv2.ellipse(photo, (int(cx), int(cy)),
                            (int(shape["rx"] * w), int(shape["ry"] * h)),
                            0, 0, 360, colour, thickness)
            elif shape["type"] == "rect":
                hw, hh = shape["w"] * w / 2, shape["h"] * h / 2
                cv2.rectangle(photo, (int(cx - hw), int(cy - hh)),
                              (int(cx + hw), int(cy + hh)), colour, thickness)
            else:
                pts = np.array([[pt["x"] * w, pt["y"] * h] for pt in shape["points"]],
                               dtype=np.int32)
                cv2.polylines(photo, [pts], True, colour, thickness)
            cv2.drawMarker(photo, (int(cx), int(cy)), colour, cv2.MARKER_CROSS, 12, 1)

        out = destination if len(data["views"]) == 1 else destination.with_name(
            f"{destination.stem}-{name}{destination.suffix}"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out), photo)
        written.append(out)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate only, do not write")
    parser.add_argument(
        "--overlay",
        nargs="?",
        const=str(ROOT / "knowledge" / "hotspots-overlay.png"),
        help="also render the hit regions onto the photo for visual review",
    )
    args = parser.parse_args()

    data = build()
    for name, view in data["views"].items():
        v = view["validation"]
        parts = view["parts"]
        print(f"[{name}] {v['method']}")
        if "held_out_error_px" in v:
            print(f"[{name}] held-out {v['held_out_point']}: {v['held_out_error_px']}px "
                  f"(limit {MAX_HELD_OUT_ERROR_PX}px)")
        shapes = sorted({p["shape"]["type"] for p in parts})
        nested = sum(1 for p in parts if "parent" in p)
        projected = sum(1 for p in parts if p["geometry_method"] == "projected")
        print(f"[{name}] parts: {len(parts)} ({projected} projected, "
              f"{len(parts) - projected} measured), {nested} nested, "
              f"shapes: {'/'.join(shapes)}, peers disjoint, "
              f"zoom {min(p['zoom'] for p in parts)}-{max(p['zoom'] for p in parts)}x")

    if args.overlay:
        for out in write_overlay(data, Path(args.overlay)):
            print(f"wrote {out.relative_to(ROOT)}")

    if args.check:
        return
    OUTPUT.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
