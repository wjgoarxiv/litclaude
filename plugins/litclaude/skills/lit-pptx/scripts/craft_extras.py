#!/usr/bin/env python3
"""craft_extras.py — the office subset of the family craft floor, for the lit-pptx QA gate.

deck_craft.py answers "does the deck look finished"; these checks answer "does it carry the
reflex defaults a designer would flag", each as a number a gate can hold:

  OF-101  one accent colour per slide (hue families among solid shape fills)
  OF-102  body text-box measure (characters per wrapped line, CJK or Latin)
  OF-103  numeric table columns aligned right
  OF-104  concentric radius on a nested rounded frame
  OF-105  gap between cards at least twice the gap between shapes inside a card
  OF-106  no gradient-filled text
  OF-107  no glow effect
  OF-108  no emoji bullets
  OF-109  no tall empty band below the last content block, on the slide or in a card

Every threshold lives in THRESHOLDS. A HIGH finding fails the gate; a MEDIUM finding is
advisory and is reported, not blocking. `tier` is "measured" when read off the OOXML and
"derived" when it rests on an inherited value (a table style's alignment).

Usage:
    python3 craft_extras.py deck.pptx          # JSON report; exit 0 always
"""

from __future__ import annotations

import os as _os
import sys as _sys

_sys.dont_write_bytecode = True  # the installed skill directory stays read-only
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path.insert(0, _os.path.join(_HERE, "..", "..", "..", "lib"))
_sys.path.insert(0, _HERE)
from office_runtime_bootstrap import ensure_runtime  # noqa: E402

ensure_runtime(["pptx"])

import colorsys  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
from pathlib import Path  # noqa: E402

from pptx import Presentation  # noqa: E402
from pptx.enum.dml import MSO_FILL  # noqa: E402
from pptx.enum.shapes import MSO_SHAPE_TYPE  # noqa: E402
from pptx.enum.text import PP_ALIGN  # noqa: E402
from pptx.oxml.ns import qn  # noqa: E402

import deck_craft  # noqa: E402
from layout_inventory import DEFAULT_INSETS, EMU_PER_IN, PT_PER_IN, _attr_int, paragraph_runs, wrap_segment  # noqa: E402

THRESHOLDS = {
    "accent": {"min_lightness": 0.12, "max_lightness": 0.93, "min_saturation": 0.12, "family_deg": 20.0,
               "content_high": 3, "content_medium": 2, "display_high": 4, "display_medium": 3},
    "measure": {"latin_max": 90, "cjk_max": 38, "cjk_share": 0.5, "narrow_min": 10, "narrow_lines": 3},
    "numeric": {"share": 0.7, "min_rows": 2},
    "radius": {"inset_spread_in": 0.06, "tolerance_in": 0.02, "min_outer_in": 0.04, "default_adj": 16667},
    # MEDIUM until the family's read-only re-run on its calibration decks promotes it.
    "grouping": {"ratio": 2.0, "severity": "MEDIUM"},
    "band": {"high": 0.35, "medium": 0.25, "row_tolerance_in": 0.05},
}
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿]")
NUMERIC_STRIP = re.compile(r"[\s,.%▲▼+\-−±()$€£¥₩]")


def _finding(check, severity, slide, shape, detail, hint, tier="measured"):
    return {"check": check, "severity": severity, "tier": tier, "slide": slide, "shape": shape, "detail": detail, "hint": hint}


def _hsl(rgb):
    r, g, b = (int(str(rgb)[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, lightness, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360.0, s, lightness


def _families(hues, width):
    """Greedy hue clustering: a hue within `width` degrees of a family joins it."""
    families = []
    for hue in sorted(hues):
        for family in families:
            if min(abs(hue - family), 360 - abs(hue - family)) <= width:
                break
        else:
            families.append(hue)
    return families


def _solid_fill(shape):
    try:
        if shape.fill.type == MSO_FILL.SOLID:
            return shape.fill.fore_color.rgb
    except (AttributeError, TypeError, ValueError, NotImplementedError):
        return None
    return None


def check_accents(slide, number, shapes, page_area, display):
    t = THRESHOLDS["accent"]
    hues = []
    for shape in shapes:
        box = deck_craft._box(shape)
        if box is None or box[2] * box[3] >= deck_craft.FULL_BLEED * page_area:
            continue
        if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
            continue
        rgb = _solid_fill(shape)
        if rgb is None:
            continue
        hue, saturation, lightness = _hsl(rgb)
        if t["min_lightness"] <= lightness <= t["max_lightness"] and saturation >= t["min_saturation"]:
            hues.append(hue)
    count = len(_families(hues, t["family_deg"]))
    high, medium = (t["display_high"], t["display_medium"]) if display else (t["content_high"], t["content_medium"])
    if count >= high:
        return [_finding("OF-101", "HIGH", number, None, f"{count} accent hue families", "Keep one accent colour per slide; move the other fills to neutrals.")]
    if count >= medium:
        return [_finding("OF-101", "MEDIUM", number, None, f"{count} accent hue families", "Two accents only when they carry a real pair (a delta or a status).")]
    return []


def _hangul_share(text):
    letters = [c for c in text if not c.isspace()]
    return sum(1 for c in letters if "가" <= c <= "힣") / max(1, len(letters))


def _wrapped_lines(shape):
    body_pr = shape.text_frame._txBody.find(qn("a:bodyPr"))
    insets = {k: _attr_int(body_pr, k, v) for k, v in DEFAULT_INSETS.items()}
    wrap = body_pr.get("wrap", "square") if body_pr is not None else "square"
    inner = (shape.width - insets["lIns"] - insets["rIns"]) / EMU_PER_IN * PT_PER_IN
    lines = 0
    for paragraph in shape.text_frame.paragraphs:
        if not paragraph.text.strip():
            continue
        for segment in paragraph_runs(paragraph, 18.0):
            lines += wrap_segment(segment, max(inner, 1.0), wrap)[0]
    return lines


def check_measure(number, shapes, title):
    t = THRESHOLDS["measure"]
    found = []
    for shape in shapes:
        if shape is title or not getattr(shape, "has_text_frame", False) or not shape.has_text_frame or shape.name.startswith("lit-notice"):
            continue
        size = deck_craft._max_pt(shape)
        if not deck_craft.CAPTION_PT < size < deck_craft.DISPLAY_PT:
            continue
        text = "".join(p.text for p in shape.text_frame.paragraphs)
        lines = _wrapped_lines(shape)
        if lines < 2 or not text.strip():
            continue
        per_line = len(text) / lines
        cjk = _hangul_share(text) >= t["cjk_share"]
        ceiling = t["cjk_max"] if cjk else t["latin_max"]
        if per_line > ceiling:
            found.append(_finding("OF-102", "HIGH", number, shape.name, f"{per_line:.0f} chars per line over {lines} lines{' (Korean)' if cjk else ''}",
                                  f"Narrow the text box or split the text; keep body lines at or under {ceiling} characters."))
        elif per_line < t["narrow_min"] and lines >= t["narrow_lines"]:
            found.append(_finding("OF-102", "MEDIUM", number, shape.name, f"{per_line:.0f} chars per line over {lines} lines",
                                  "Widen the column; very short lines read as broken wrapping."))
    return found


def _numeric(text):
    stripped = NUMERIC_STRIP.sub("", text)
    return bool(stripped) and stripped.isdigit()


def check_numeric_columns(number, shapes):
    t = THRESHOLDS["numeric"]
    found = []
    for shape in shapes:
        if not getattr(shape, "has_table", False) or not shape.has_table:
            continue
        rows = list(shape.table.rows)
        data = rows[1:]
        if len(data) < t["min_rows"]:
            continue
        # A second header-like row (no number in it) above numeric rows is out of scope for now.
        if data and not any(_numeric(cell.text) for cell in data[0].cells) and any(_numeric(cell.text) for row in data[1:] for cell in row.cells):
            continue
        for column in range(len(shape.table.columns)):
            cells = [row.cells[column] for row in data]
            filled = [cell for cell in cells if cell.text.strip()]
            numbers = [cell for cell in filled if _numeric(cell.text)]
            if len(numbers) < t["min_rows"] or len(numbers) / max(1, len(filled)) < t["share"]:
                continue
            explicit = [cell for cell in numbers if any(p.alignment not in (None, PP_ALIGN.RIGHT) for p in cell.text_frame.paragraphs if p.text.strip())]
            inherited = [cell for cell in numbers if all(p.alignment is None for p in cell.text_frame.paragraphs if p.text.strip())]
            if explicit:
                found.append(_finding("OF-103", "HIGH", number, shape.name, f"column {column + 1}: {len(explicit)} number cell(s) not right-aligned",
                                      "Right-align numeric columns so the digits line up."))
            elif inherited:
                found.append(_finding("OF-103", "MEDIUM", number, shape.name, f"column {column + 1}: alignment inherited, not verified",
                                      "Set right alignment on numeric cells explicitly.", tier="derived"))
    return found


def _radius_in(shape):
    geometry = shape._element.find(".//" + qn("a:prstGeom"))
    if geometry is None or geometry.get("prst") != "roundRect":
        return None
    adj = THRESHOLDS["radius"]["default_adj"]
    guide = geometry.find(".//" + qn("a:gd"))
    if guide is not None and (guide.get("fmla") or "").startswith("val "):
        adj = int(guide.get("fmla").split()[1])
    return adj / 100000.0 * min(shape.width, shape.height) / EMU_PER_IN


def check_concentric(number, shapes):
    t = THRESHOLDS["radius"]
    rounded = [(shape, deck_craft._box(shape), _radius_in(shape)) for shape in shapes]
    rounded = [(s, b, r) for s, b, r in rounded if b is not None and r is not None]
    found = []
    for inner, ibox, iradius in rounded:
        for outer, obox, oradius in rounded:
            if inner is outer or not deck_craft._contains(obox, ibox, tol=0.0):
                continue
            pads = [ibox[0] - obox[0], ibox[1] - obox[1], obox[0] + obox[2] - ibox[0] - ibox[2], obox[1] + obox[3] - ibox[1] - ibox[3]]
            if max(pads) - min(pads) > t["inset_spread_in"] or oradius <= t["min_outer_in"]:
                continue
            expected = max(0.0, oradius - sum(pads) / 4)
            if abs(iradius - expected) > t["tolerance_in"]:
                found.append(_finding("OF-104", "HIGH", number, inner.name, f"inner radius {iradius:.2f}in, expected {expected:.2f}in",
                                      "Set the inner radius to the outer radius minus the frame's padding."))
    return found


def _gap(a, b):
    """Clear distance between two boxes; 0 when they overlap."""
    dx = max(0.0, b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]))
    dy = max(0.0, b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]))
    return max(dx, dy)


def check_grouping(number, shapes, page_area):
    """Cards are filled or outlined rectangles holding other shapes; compare their spacing.

    The gap inside a card is the smallest clear gap between two shapes it encloses; a shape's
    inset to the card's own edge is padding and never counts.
    """
    ratio = THRESHOLDS["grouping"]["ratio"]
    severity = THRESHOLDS["grouping"]["severity"]
    boxes = [(shape, deck_craft._box(shape)) for shape in shapes]
    cards = [(s, b) for s, b in boxes if b and s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE and not deck_craft._text(s)
             and (deck_craft._filled(s) or deck_craft._outlined(s)) and 0.5 <= b[2] * b[3] < deck_craft.FULL_BLEED * page_area]
    members = {}
    for card, cbox in cards:
        inside = [b for s, b in boxes if b and s is not card and deck_craft._contains(cbox, b, tol=0.02) and b != cbox]
        if inside:
            members[id(card)] = (card, cbox, inside)
    within = {}
    for key, (card, cbox, inside) in members.items():
        gaps = [_gap(a, b) for i, a in enumerate(inside) for b in inside[i + 1:]]
        gaps = [gap for gap in gaps if gap > 0]
        if gaps:
            within[key] = min(gaps)
    found = []
    ordered = list(members.values())
    for i, (a, abox, _) in enumerate(ordered):
        for b, bbox, _ in ordered[i + 1:]:
            inner = max([within[k] for k in (id(a), id(b)) if k in within], default=None)
            between = _gap(abox, bbox)
            if inner is not None and 0 < between < ratio * inner:
                found.append(_finding("OF-105", severity, number, f"{a.name} / {b.name}", f"{between:.2f}in between cards, {inner:.2f}in between shapes inside",
                                      "Space the cards at least twice the gap between their contents apart, or tighten the contents."))
    return found


def check_run_effects(number, slide):
    found = []
    for shape in slide.shapes:
        element = shape._element
        if element.findall(".//" + qn("a:rPr") + "/" + qn("a:gradFill")):
            found.append(_finding("OF-106", "HIGH", number, shape.name, "gradient-filled text", "Use a solid text colour; emphasise with weight or size."))
        if element.findall(".//" + qn("a:glow")):
            found.append(_finding("OF-107", "HIGH", number, shape.name, "glow effect", "Remove the glow; use a solid fill or a thin neutral shadow."))
        for bullet in element.iter(qn("a:buChar")):
            if EMOJI.search(bullet.get("char") or ""):
                found.append(_finding("OF-108", "HIGH", number, shape.name, f"emoji bullet {bullet.get('char')}", "Use the template's bullet or a plain symbol."))
    return found


def _band(top, bottom, boxes):
    """(largest gap before the trailing one, trailing gap) as fractions of the height."""
    height = bottom - top
    if height <= 0:
        return 0.0, 0.0
    edges = [top]
    cursor = top
    for box in sorted(boxes, key=lambda b: b[1]):
        edges.append(max(cursor, box[1]))
        cursor = max(cursor, box[1] + box[3])
        edges.append(cursor)
    edges.append(bottom)
    gaps = [edges[i + 1] - edges[i] for i in range(0, len(edges) - 1, 2)]
    return max(gaps[:-1], default=0.0) / height, gaps[-1] / height


def check_bands(number, shapes, area, boxes, page_area):
    t = THRESHOLDS["band"]
    found = []
    regions = [("slide", area, boxes)]
    for shape in shapes:
        box = deck_craft._box(shape)
        if not box or shape.shape_type != MSO_SHAPE_TYPE.AUTO_SHAPE or deck_craft._text(shape) or not deck_craft._filled(shape):
            continue
        if not 0.5 <= box[2] * box[3] < deck_craft.FULL_BLEED * page_area:
            continue
        inside = [(s, b) for s in shapes for b in [deck_craft._box(s)] if b and s is not shape and deck_craft._contains(box, b, tol=0.02) and b != box]
        if not inside:
            continue
        # A card that is itself display-style (one or two large lines, no visual) is exempt.
        large = [s for s, _ in inside if deck_craft._text(s) and deck_craft._max_pt(s) >= deck_craft.DISPLAY_PT]
        if large and len(large) <= 2 and not any(deck_craft._is_table(s) or deck_craft._is_chart(s) for s, _ in inside):
            continue
        regions.append((shape.name, box, [b for _, b in inside]))
    bands = {}
    for name, region, contents in regions:
        if contents:
            bands[name] = _band(region[1], region[1] + region[3], [b for b in contents if b[1] < region[1] + region[3]])
    # Cards sharing a top edge and height form a row; the row's height imposes a trailing band on
    # the card with the least text, so the row counts its smallest trailing band.
    tol = t["row_tolerance_in"]
    cards = [(name, region) for name, region, _ in regions if name != "slide" and name in bands]
    for name, region in cards:
        row = [other for other, box in cards if abs(box[1] - region[1]) <= tol and abs(box[3] - region[3]) <= tol]
        if len(row) > 1:
            bands[name] = (bands[name][0], min(bands[other][1] for other in row))
    for name, region, contents in regions:
        if name not in bands:
            continue
        fraction = max(bands[name])
        if fraction > t["high"]:
            found.append(_finding("OF-109", "HIGH", number, None if name == "slide" else name, f"{fraction:.0%} of the {'content area' if name == 'slide' else 'card'} is one empty band",
                                  "Fill the band with the message's visual, shrink the region to its content, or merge slides."))
        elif fraction > t["medium"]:
            found.append(_finding("OF-109", "MEDIUM", number, None if name == "slide" else name, f"{fraction:.0%} empty band",
                                  "Tighten the region around its content."))
    return found


def analyse(path: Path) -> dict:
    prs = Presentation(str(path))
    W, H = prs.slide_width / EMU_PER_IN, prs.slide_height / EMU_PER_IN
    page_area = W * H
    findings = []
    for number, slide in enumerate(prs.slides, start=1):
        shapes = [s for s in slide.shapes if not s.name.startswith("lit-notice")]
        layout = deck_craft.slide_layout(shapes, W, H, page_area)
        findings += check_run_effects(number, slide)
        findings += check_accents(slide, number, shapes, page_area, layout["display"])
        findings += check_numeric_columns(number, shapes)
        findings += check_concentric(number, shapes)
        if layout["display"]:
            continue
        findings += check_measure(number, shapes, layout["title"])
        findings += check_grouping(number, shapes, page_area)
        findings += check_bands(number, shapes, layout["area"], layout["boxes"], page_area)
    return {"file": str(path), "pass": not any(f["severity"] == "HIGH" for f in findings), "findings": findings}


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    print(json.dumps(analyse(Path(argv[0])), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(_sys.argv[1:]))
