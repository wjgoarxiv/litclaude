#!/usr/bin/env python3
"""Convert Markdown to DOCX with proper styling.

Usage:
    python convert_md_to_docx.py input.md output.docx [--template template.docx]
    python convert_md_to_docx.py input.md output.docx --publisher elsevier

Features:
- Headings (H1-H6 → Word heading styles)
- Paragraphs with bold/italic/code formatting
- Bullet and numbered lists
- Tables
- Code blocks (monospace font)
- Images (if local)
- Links (as hyperlinks)
- [NEW in M1] --publisher NAME loads templates/registry.yaml and applies
  journal design discipline: title block from YAML frontmatter, curly
  quotes, en/em dashes, nbsp before units, ellipsis, heading auto-numbering,
  booktabs tables, banned-font/style stripping, CJK font pairing.
"""

from __future__ import annotations
import os as _os
import sys as _sys

_sys.dont_write_bytecode = True  # the installed skill directory stays read-only
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", "lib"))
from office_runtime_bootstrap import ensure_runtime  # noqa: E402
from office_data import DataError, resolve_text  # noqa: E402

ensure_runtime(["docx", "markdown", "bs4", "yaml"])

import argparse
import re
import sys
from pathlib import Path
from typing import Any

try:
    import markdown
    from markdown.extensions.tables import TableExtension
    from markdown.extensions.fenced_code import FencedCodeExtension
except ImportError:
    print("Error: 'markdown' library not found. Install with: pip install markdown")
    sys.exit(1)

try:
    from docx import Document
    from docx.shared import Pt, Inches, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.style import WD_STYLE_TYPE
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
except ImportError:
    print("Error: 'python-docx' library not found. Install with: pip install python-docx")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup, NavigableString
except ImportError:
    print("Error: 'beautifulsoup4' library not found. Install with: pip install beautifulsoup4")
    sys.exit(1)


# ===========================================================================
# Legacy HTML→DOCX helpers (unchanged from pre-M1 — preserved byte-for-byte)
# ===========================================================================


def create_hyperlink(paragraph, url: str, text: str):
    """Add a hyperlink to a paragraph."""
    part = paragraph.part
    r_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)

    hyperlink = OxmlElement('w:hyperlink')
    hyperlink.set(qn('r:id'), r_id)

    new_run = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')

    # Blue color and underline for hyperlink
    color = OxmlElement('w:color')
    color.set(qn('w:val'), '0000FF')
    rPr.append(color)

    underline = OxmlElement('w:u')
    underline.set(qn('w:val'), 'single')
    rPr.append(underline)

    new_run.append(rPr)

    text_elem = OxmlElement('w:t')
    text_elem.text = text
    new_run.append(text_elem)

    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def process_inline_elements(paragraph, element, md_path: Path):
    """Process inline elements like bold, italic, code, links within a paragraph."""
    if isinstance(element, NavigableString):
        text = str(element)
        if text.strip():
            paragraph.add_run(text)
        elif text:
            paragraph.add_run(text)
        return

    if element.name == 'strong' or element.name == 'b':
        run = paragraph.add_run(element.get_text())
        run.bold = True
    elif element.name == 'em' or element.name == 'i':
        run = paragraph.add_run(element.get_text())
        run.italic = True
    elif element.name == 'code':
        run = paragraph.add_run(element.get_text())
        run.font.name = 'Courier New'
        run.font.size = Pt(10)
    elif element.name == 'a':
        href = element.get('href', '')
        text = element.get_text()
        if href:
            create_hyperlink(paragraph, href, text)
        else:
            paragraph.add_run(text)
    elif element.name == 'img':
        src = element.get('src', '')
        if src and not src.startswith(('http://', 'https://', 'data:')):
            img_path = (md_path.parent / src).resolve()
            if img_path.exists():
                try:
                    paragraph.add_run().add_picture(str(img_path), width=Inches(4))
                except Exception:
                    paragraph.add_run(f"[Image: {src}]")
            else:
                paragraph.add_run(f"[Image not found: {src}]")
        else:
            paragraph.add_run(f"[Image: {src}]")
    elif element.name == 'br':
        paragraph.add_run('\n')
    else:
        # Recursively process children
        for child in element.children:
            process_inline_elements(paragraph, child, md_path)


def add_paragraph_with_formatting(doc: Document, element, md_path: Path, style: str = None):
    """Add a paragraph with inline formatting."""
    para = doc.add_paragraph(style=style)
    for child in element.children:
        process_inline_elements(para, child, md_path)
    return para


def process_list(doc: Document, element, md_path: Path, ordered: bool = False, level: int = 0):
    """Process ordered or unordered lists."""
    for i, li in enumerate(element.find_all('li', recursive=False)):
        # Create paragraph with list style
        para = doc.add_paragraph(style='List Number' if ordered else 'List Bullet')

        # Set indentation for nested lists
        if level > 0:
            para.paragraph_format.left_indent = Inches(0.5 * level)

        # Process direct text content
        for child in li.children:
            if isinstance(child, NavigableString):
                text = str(child).strip()
                if text:
                    para.add_run(text)
            elif child.name in ('ul', 'ol'):
                # Nested list
                process_list(doc, child, md_path, ordered=(child.name == 'ol'), level=level + 1)
            elif child.name == 'p':
                # Process paragraph content inline
                for subchild in child.children:
                    process_inline_elements(para, subchild, md_path)
            else:
                process_inline_elements(para, child, md_path)


def process_table(doc: Document, element, md_path: Path):
    """Process HTML table and create DOCX table."""
    rows = element.find_all('tr')
    if not rows:
        return

    # Count columns from first row
    first_row = rows[0]
    cols = len(first_row.find_all(['th', 'td']))

    if cols == 0:
        return

    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = 'Table Grid'

    for row_idx, tr in enumerate(rows):
        cells = tr.find_all(['th', 'td'])
        for col_idx, cell in enumerate(cells):
            if col_idx < cols:
                table_cell = table.rows[row_idx].cells[col_idx]
                # Clear default paragraph
                table_cell.text = ''
                para = table_cell.paragraphs[0]
                for child in cell.children:
                    process_inline_elements(para, child, md_path)

                # Bold for header cells
                if cell.name == 'th':
                    for run in para.runs:
                        run.bold = True

    shape_table(doc, table, [[c.get_text(" ", strip=True) for c in tr.find_all(['th', 'td'])] for tr in rows])


# A cell reads as a number when, after signs and units, only digits remain.
NUMERIC_CELL = re.compile(r"^[+\-−±▲▼△▽]?\s*[\d.,]+\s*(?:%p?|배|x|pt|[가-힣]{1,3}|[A-Za-z]{1,3})?$")


def shape_table(doc, table, texts: list[list[str]]) -> None:
    """Give a table readable columns and keep it whole on the page.

    Column widths follow the longest cell of each column (Hangul counted wider)
    with a floor, so a short column never squeezes a long one into one word per
    line. The header row repeats on a new page, a row never splits across pages,
    and columns of numbers are right-aligned.
    """
    if not texts or not texts[0]:
        return
    cols = len(table.columns)
    section = doc.sections[-1]
    usable = section.page_width - section.left_margin - section.right_margin

    def width_of(text: str) -> float:
        # Hangul runs a little over twice as wide as Latin; +3 covers the cell padding.
        return sum(2.3 if "\uac00" <= ch <= "\ud7a3" else 1.0 for ch in text) + 3.0

    want = []
    for ci in range(cols):
        column = [row[ci] for row in texts if ci < len(row)]
        want.append(max([width_of(t) for t in column] + [4.0]))
    # Each column first gets its natural width (about 0.085 in per Latin character at
    # body size, capped at 45% of the line); columns that hit the cap share what is left.
    unit = Inches(0.085)
    cap = usable * 0.45
    natural = [min(w * unit, cap) for w in want]
    capped = [ci for ci in range(cols) if want[ci] * unit > cap]
    spare = usable - sum(natural)
    if spare > 0 and capped:
        for ci in capped:
            natural[ci] += spare / len(capped)
    elif spare > 0:
        natural = [w + spare / cols for w in natural]
    scale = usable / sum(natural)
    widths = [int(w * scale) for w in natural]

    table.autofit = False
    for ci, column in enumerate(table.columns):
        column.width = widths[ci]
    for ri, row in enumerate(table.rows):
        tr_pr = row._tr.get_or_add_trPr()
        # Schema order puts cantSplit before trHeight and tblHeader after it.
        tr_pr.insert(0, OxmlElement("w:cantSplit"))
        if ri == 0:
            header = OxmlElement("w:tblHeader")
            tr_pr.append(header)
        for ci, cell in enumerate(row.cells):
            if ci < cols:
                cell.width = widths[ci]
                for paragraph in cell.paragraphs:
                    # Body line spacing (1.6 in some profiles) makes every row a double row.
                    paragraph.paragraph_format.line_spacing = 1.15
                    paragraph.paragraph_format.space_after = Pt(0)
                    paragraph.paragraph_format.first_line_indent = Cm(0)

    for ci in range(cols):
        data = [row[ci] for row in texts[1:] if ci < len(row) and row[ci].strip()]
        if data and all(NUMERIC_CELL.match(t.strip()) for t in data):
            for row in table.rows:
                for paragraph in row.cells[ci].paragraphs:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT


def process_code_block(doc: Document, element):
    """Process code block with monospace formatting."""
    code = element.find('code')
    text = code.get_text() if code else element.get_text()

    para = doc.add_paragraph()
    run = para.add_run(text)
    run.font.name = 'Courier New'
    run.font.size = Pt(9)

    # Light gray background (via shading)
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), 'F0F0F0')
    para._p.get_or_add_pPr().append(shading)


def html_to_docx(html: str, doc: Document, md_path: Path):
    """Convert HTML to DOCX elements."""
    soup = BeautifulSoup(html, 'html.parser')

    for element in soup.children:
        if isinstance(element, NavigableString):
            text = str(element).strip()
            if text:
                doc.add_paragraph(text)
            continue

        if element.name in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            level = int(element.name[1])
            heading = doc.add_heading(level=level)
            for child in element.children:
                process_inline_elements(heading, child, md_path)

        elif element.name == 'p':
            add_paragraph_with_formatting(doc, element, md_path)

        elif element.name == 'ul':
            process_list(doc, element, md_path, ordered=False)

        elif element.name == 'ol':
            process_list(doc, element, md_path, ordered=True)

        elif element.name == 'table':
            process_table(doc, element, md_path)

        elif element.name == 'pre':
            process_code_block(doc, element)

        elif element.name == 'blockquote':
            para = doc.add_paragraph(style='Quote')
            for child in element.children:
                if child.name == 'p':
                    for subchild in child.children:
                        process_inline_elements(para, subchild, md_path)
                else:
                    process_inline_elements(para, child, md_path)

        elif element.name == 'hr':
            # Add a horizontal line
            para = doc.add_paragraph()
            para.add_run('─' * 50)
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER

        elif element.name in ('div', 'section', 'article'):
            # Recursively process container elements
            html_to_docx(str(element), doc, md_path)


# ===========================================================================
# M1: Journal workflow — frontmatter, filters, design enforcement
# ===========================================================================


def _load_yaml():
    try:
        import yaml
        return yaml
    except ImportError:
        print("Error: 'pyyaml' library required for --publisher. pip install pyyaml")
        sys.exit(1)


def parse_frontmatter(md_text: str) -> tuple[dict, str]:
    """Extract leading YAML frontmatter. Returns (frontmatter_dict, body)."""
    if not md_text.startswith("---"):
        return {}, md_text
    # Find closing fence
    lines = md_text.splitlines(keepends=True)
    if len(lines) < 2:
        return {}, md_text
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}, md_text
    yaml_src = "".join(lines[1:end_idx])
    body = "".join(lines[end_idx + 1:])
    yaml = _load_yaml()
    try:
        data = yaml.safe_load(yaml_src) or {}
    except Exception as exc:
        print(f"Warning: could not parse YAML frontmatter: {exc}", file=sys.stderr)
        return {}, md_text
    if not isinstance(data, dict):
        return {}, md_text
    return data, body


def load_publisher(registry_path: Path, name: str) -> dict:
    yaml = _load_yaml()
    if not registry_path.exists():
        raise SystemExit(f"Error: registry not found: {registry_path}")
    with registry_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    pubs = data.get("publishers") or {}
    if name not in pubs:
        raise SystemExit(
            f"Error: publisher {name!r} not in registry "
            f"(known: {', '.join(sorted(pubs)) or 'none'})"
        )
    return pubs[name]


# ---------------------------------------------------------------------------
# Code-preserving filter helpers
# ---------------------------------------------------------------------------


_FENCE_RE = re.compile(r"(^```.*?^```)", re.MULTILINE | re.DOTALL)
_INLINE_CODE_RE = re.compile(r"(`[^`\n]+`)")


def _split_code_preserving(text: str) -> list[tuple[str, bool]]:
    """Split text into (segment, is_code) tuples.

    Fenced code blocks and inline backtick code are returned as is_code=True
    and must never be touched by the micro-typography filters.
    """
    # First split on fenced code blocks
    out: list[tuple[str, bool]] = []
    pos = 0
    for m in _FENCE_RE.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], False))
        out.append((m.group(0), True))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False))
    # Then split non-code segments on inline backtick code
    refined: list[tuple[str, bool]] = []
    for seg, is_code in out:
        if is_code:
            refined.append((seg, True))
            continue
        last = 0
        for m in _INLINE_CODE_RE.finditer(seg):
            if m.start() > last:
                refined.append((seg[last:m.start()], False))
            refined.append((m.group(0), True))
            last = m.end()
        if last < len(seg):
            refined.append((seg[last:], False))
    return refined


def _apply_to_noncode(text: str, fn) -> str:
    parts = _split_code_preserving(text)
    out = []
    for seg, is_code in parts:
        out.append(seg if is_code else fn(seg))
    return "".join(out)


# ---------------------------------------------------------------------------
# Pre-MD micro-typography filters
# ---------------------------------------------------------------------------


_NUMRANGE_RE = re.compile(r"(\d)-(\d)")
_PAREN_DASH_RE = re.compile(r"(\w) - (\w)")


def fix_dashes(text: str, rules: dict | None = None) -> str:
    """Numeric ranges → en-dash; parenthetical 'word - word' → em-dash.

    rules is the design.micro_typography.dashes block (currently informational;
    M1 hardcodes en-dash for numeric range and em-dash for parenthetical).
    """
    def _fn(seg: str) -> str:
        seg = _NUMRANGE_RE.sub(lambda m: f"{m.group(1)}\u2013{m.group(2)}", seg)
        seg = _PAREN_DASH_RE.sub(lambda m: f"{m.group(1)} \u2014 {m.group(2)}", seg)
        return seg
    return _apply_to_noncode(text, _fn)


def fix_quotes(text: str) -> str:
    """ASCII "..." → "..."; '...' → '...' via left/right state machine."""
    def _fn(seg: str) -> str:
        out_chars = []
        open_dq = True
        open_sq = True
        for ch in seg:
            if ch == '"':
                out_chars.append("\u201C" if open_dq else "\u201D")
                open_dq = not open_dq
            elif ch == "'":
                # Keep apostrophe if surrounded by letters (e.g. "don't")
                prev = out_chars[-1] if out_chars else ""
                if prev.isalpha():
                    out_chars.append("\u2019")
                else:
                    out_chars.append("\u2018" if open_sq else "\u2019")
                    open_sq = not open_sq
            else:
                out_chars.append(ch)
        return "".join(out_chars)
    return _apply_to_noncode(text, _fn)


_UNIT_GROUP = (
    r"mg|g|kg|mL|L|\u03BCL|uL|nm|\u03BCm|um|mm|cm|m|km|K|\u00B0C|%|min|h|s|ms"
)
_UNIT_RE = re.compile(rf"(\d)(\s+)({_UNIT_GROUP})(?=\b|\W|$)")
_FIG_RE = re.compile(r"(Fig\.)\s(\d)")
_TABLE_RE = re.compile(r"(Table)\s(\d)")
_EQ_RE = re.compile(r"(Eq\.)\s(\d)")


def fix_unit_spacing(text: str) -> str:
    """Insert U+00A0 between number and SI unit, and after Fig./Table/Eq."""
    def _fn(seg: str) -> str:
        seg = _UNIT_RE.sub(lambda m: f"{m.group(1)}\u00A0{m.group(3)}", seg)
        seg = _FIG_RE.sub(lambda m: f"{m.group(1)}\u00A0{m.group(2)}", seg)
        seg = _TABLE_RE.sub(lambda m: f"{m.group(1)}\u00A0{m.group(2)}", seg)
        seg = _EQ_RE.sub(lambda m: f"{m.group(1)}\u00A0{m.group(2)}", seg)
        return seg
    return _apply_to_noncode(text, _fn)


def fix_ellipsis(text: str) -> str:
    def _fn(seg: str) -> str:
        return seg.replace("...", "\u2026")
    return _apply_to_noncode(text, _fn)


def normalize_double_spaces(text: str) -> str:
    def _fn(seg: str) -> str:
        # Preserve leading indentation; collapse interior double spaces
        lines = seg.split("\n")
        cleaned = []
        for line in lines:
            stripped_left = line.lstrip(" ")
            lead = line[: len(line) - len(stripped_left)]
            cleaned.append(lead + re.sub(r" {2,}", " ", stripped_left))
        return "\n".join(cleaned)
    return _apply_to_noncode(text, _fn)


# ---------------------------------------------------------------------------
# Post-HTML (doc object) filters
# ---------------------------------------------------------------------------


def apply_heading_numbering(doc, design: dict) -> None:
    def to_roman(value: int) -> str:
        numerals = [
            (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
            (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
            (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
        ]
        out: list[str] = []
        remaining = value
        for arabic, roman in numerals:
            while remaining >= arabic:
                out.append(roman)
                remaining -= arabic
        return "".join(out)

    def prefix_for(level: int, counters: list[int]) -> str | None:
        key = f"h{level}"
        cfg = (design.get("heading_hierarchy") or {}).get(key) or {}
        numbering = cfg.get("numbering")
        if numbering is None:
            return None
        numbering = str(numbering).strip()
        if level == 1 and numbering.upper() == "I.":
            return f"{to_roman(counters[0])}. "
        if level == 1:
            return f"{counters[0]}. "
        if level == 2:
            return f"{counters[0]}.{counters[1]}. "
        if level == 3:
            return f"{counters[0]}.{counters[1]}.{counters[2]}. "
        return None

    counters = [0, 0, 0]
    for para in doc.paragraphs:
        style_name = para.style.name if para.style else ""
        level = 0
        if style_name == "Heading 1":
            level = 1
            counters[0] += 1
            counters[1] = 0
            counters[2] = 0
        elif style_name == "Heading 2":
            level = 2
            counters[1] += 1
            counters[2] = 0
        elif style_name == "Heading 3":
            level = 3
            counters[2] += 1
        else:
            continue
        prefix = prefix_for(level, counters)
        if prefix is None:
            continue
        current = para.text or ""
        # Skip if already numbered (e.g. "1 Introduction" from the source)
        if re.match(r"^(?:\d+(?:\.\d+)*\.?|[IVXLCDM]+\.?)\s", current):
            continue
        if para.runs:
            para.runs[0].text = prefix + para.runs[0].text
        else:
            para.add_run(prefix)


def _set_cell_borders_nil(tcPr):
    tcBorders = tcPr.find(qn("w:tcBorders"))
    if tcBorders is None:
        tcBorders = OxmlElement("w:tcBorders")
        tcPr.append(tcBorders)
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = tcBorders.find(qn(f"w:{side}"))
        if el is None:
            el = OxmlElement(f"w:{side}")
            tcBorders.append(el)
        el.set(qn("w:val"), "nil")
        el.set(qn("w:sz"), "0")


def apply_table_style(doc, design: dict) -> None:
    """Override python-docx 'Table Grid' with booktabs: only horizontal rules.

    Rules: top rule (table top), header-bottom rule, bottom rule (table bottom).
    All vertical rules (left/right/insideV) set to nil.
    """
    for table in doc.tables:
        table.style = None  # detach Table Grid
        tbl = table._tbl
        tblPr = tbl.find(qn("w:tblPr"))
        if tblPr is None:
            tblPr = OxmlElement("w:tblPr")
            tbl.insert(0, tblPr)
        # Remove any existing tblBorders and add our booktabs set
        existing = tblPr.find(qn("w:tblBorders"))
        if existing is not None:
            tblPr.remove(existing)
        tblBorders = OxmlElement("w:tblBorders")

        def _add_border(name: str, val: str, sz: str):
            el = OxmlElement(f"w:{name}")
            el.set(qn("w:val"), val)
            el.set(qn("w:sz"), sz)
            el.set(qn("w:space"), "0")
            el.set(qn("w:color"), "000000")
            tblBorders.append(el)

        _add_border("top", "single", "12")       # ~1.5pt
        _add_border("bottom", "single", "12")    # ~1.5pt
        _add_border("left", "nil", "0")
        _add_border("right", "nil", "0")
        _add_border("insideH", "single", "6")    # ~0.75pt (header-bottom)
        _add_border("insideV", "nil", "0")       # explicit no verticals
        tblPr.append(tblBorders)

        # Bold header row + add bottom border only to header cells so the
        # thicker rule sits under the header (and horizontal rules between
        # body rows are suppressed)
        if table.rows:
            header_row = table.rows[0]
            for cell in header_row.cells:
                for p in cell.paragraphs:
                    for r in p.runs:
                        r.bold = True
            # Remove insideH to prevent inner body rules; header-bottom comes
            # from a per-cell bottom border on the first row.
            insideH = tblBorders.find(qn("w:insideH"))
            if insideH is not None:
                insideH.set(qn("w:val"), "nil")
            for cell in header_row.cells:
                tcPr = cell._tc.get_or_add_tcPr()
                tcBorders = tcPr.find(qn("w:tcBorders"))
                if tcBorders is None:
                    tcBorders = OxmlElement("w:tcBorders")
                    tcPr.append(tcBorders)
                existing_bottom = tcBorders.find(qn("w:bottom"))
                if existing_bottom is None:
                    existing_bottom = OxmlElement("w:bottom")
                    tcBorders.append(existing_bottom)
                existing_bottom.set(qn("w:val"), "single")
                existing_bottom.set(qn("w:sz"), "6")
                existing_bottom.set(qn("w:space"), "0")
                existing_bottom.set(qn("w:color"), "000000")


def strip_banned(doc, design: dict) -> None:
    """Remove any banned font/style from runs and paragraphs."""
    banned = design.get("banned") or {}
    banned_fonts = set(banned.get("fonts") or [])
    banned_styles = set(banned.get("styles") or [])
    body_font = None
    # body font is enforced on Normal style already, but we override raw runs too
    for para in doc.paragraphs:
        if para.style and para.style.name in banned_styles:
            try:
                para.style = doc.styles["Normal"]
            except KeyError:
                pass
        for run in para.runs:
            if run.font.name and run.font.name in banned_fonts:
                run.font.name = None  # inherit from style
    # Also walk table cells
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    if para.style and para.style.name in banned_styles:
                        try:
                            para.style = doc.styles["Normal"]
                        except KeyError:
                            pass
                    for run in para.runs:
                        if run.font.name and run.font.name in banned_fonts:
                            run.font.name = None


def _set_run_fonts(run, latin: str, cjk: str | None) -> None:
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:cs"), latin)
    if cjk:
        rfonts.set(qn("w:eastAsia"), cjk)


def apply_cjk_font_pairing(doc, font_cfg: dict) -> None:
    body = font_cfg.get("body") or {}
    body_cjk = font_cfg.get("body_cjk") or {}
    latin = body.get("family")
    cjk = body_cjk.get("family")
    if not latin:
        return

    def _walk(paragraphs):
        for para in paragraphs:
            for run in para.runs:
                # Only fix runs that already have a font set to something
                # other than the registry-banned default; leaving run.font.name
                # as None lets the style do its job. We still force eastAsia.
                current_name = run.font.name
                if current_name and current_name != "Courier New":
                    _set_run_fonts(run, latin, cjk)
                elif not current_name:
                    # set only eastAsia pair to avoid losing style inheritance
                    rpr = run._element.get_or_add_rPr()
                    rfonts = rpr.find(qn("w:rFonts"))
                    if rfonts is None:
                        rfonts = OxmlElement("w:rFonts")
                        rpr.append(rfonts)
                    if cjk:
                        rfonts.set(qn("w:eastAsia"), cjk)

    _walk(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                _walk(cell.paragraphs)


# ---------------------------------------------------------------------------
# Title block builder
# ---------------------------------------------------------------------------


def _insert_paragraph_before(doc, before_p, style=None):
    """Insert a new paragraph before the given paragraph element."""
    new_p = OxmlElement("w:p")
    before_p._p.addprevious(new_p)
    from docx.text.paragraph import Paragraph
    para = Paragraph(new_p, before_p._parent)
    if style is not None:
        try:
            para.style = doc.styles[style]
        except KeyError:
            pass
    return para


def inject_title_block(doc, frontmatter: dict, design: dict) -> None:
    """Prepend title/authors/affiliations/abstract/keywords to the doc.

    Builds the block at the top of the document body via the underlying
    XML so it appears before any html_to_docx output. Called BEFORE
    html_to_docx in M1's control flow so paragraphs just append normally.
    """
    tb = design.get("title_block") or {}
    title = frontmatter.get("title")
    if not title:
        return

    def _p_center(size: int, bold=False, italic=False, space_after=4):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.first_line_indent = Cm(0)
        p.paragraph_format.space_after = Pt(space_after)
        return p

    def _add_run(p, text: str, size: int, bold=False, italic=False, sup=False):
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.bold = bold
        run.italic = italic
        run.font.superscript = sup
        return run

    # Title
    tp = _p_center(
        tb.get("title", {}).get("size_pt", 18),
        bold=True,
        space_after=tb.get("title", {}).get("space_after_pt", 12),
    )
    _add_run(tp, str(title), tb.get("title", {}).get("size_pt", 18), bold=True)

    # Report-style frontmatter: a subtitle and one author / organisation / date line
    # when there is no journal author list.
    if frontmatter.get("subtitle"):
        sp = _p_center(13, space_after=6)
        _add_run(sp, str(frontmatter["subtitle"]), 13)
    if not frontmatter.get("authors"):
        meta = [str(v) for v in (frontmatter.get("author"), frontmatter.get("organization"), frontmatter.get("date")) if v]
        if meta:
            mp = _p_center(10.5, space_after=14)
            _add_run(mp, " · ".join(meta), 10.5)

    # Authors
    authors = frontmatter.get("authors") or []
    if authors:
        ap = _p_center(
            tb.get("authors", {}).get("size_pt", 12),
            space_after=tb.get("authors", {}).get("space_after_pt", 4),
        )
        sep = tb.get("author_separator", ", ")
        corr_mark = tb.get("corresponding_marker", "*")
        size = tb.get("authors", {}).get("size_pt", 12)
        for i, author in enumerate(authors):
            if not isinstance(author, dict):
                continue
            if i > 0:
                _add_run(ap, sep, size)
            name = str(author.get("name", "Author"))
            _add_run(ap, name, size)
            aff = author.get("affiliation")
            if aff is not None:
                if isinstance(aff, list):
                    aff_text = ",".join(str(a) for a in aff)
                else:
                    aff_text = str(aff)
                _add_run(ap, aff_text, size, sup=True)
            if author.get("corresponding"):
                _add_run(ap, corr_mark, size, sup=True)

    # Affiliations
    affs = frontmatter.get("affiliations")
    if isinstance(affs, dict):
        for key in sorted(affs.keys(), key=lambda k: str(k)):
            fp = _p_center(
                tb.get("affiliations", {}).get("size_pt", 10),
                italic=True,
                space_after=2,
            )
            _add_run(
                fp,
                f"{key} {affs[key]}",
                tb.get("affiliations", {}).get("size_pt", 10),
                italic=True,
            )

    # Corresponding email (if present, small italic line)
    corr_email = frontmatter.get("corresponding_email")
    if corr_email:
        cp = _p_center(10, italic=True, space_after=8)
        _add_run(cp, f"* Corresponding author: {corr_email}", 10, italic=True)

    # Abstract
    abstract = frontmatter.get("abstract")
    if abstract:
        lp = doc.add_paragraph()
        lp.paragraph_format.first_line_indent = Cm(0)
        lp.paragraph_format.space_after = Pt(4)
        _add_run(
            lp,
            tb.get("abstract_label", "Abstract"),
            tb.get("abstract_font_size_pt", 10),
            bold=True,
        )
        body = doc.add_paragraph()
        body.paragraph_format.first_line_indent = Cm(0)
        body.paragraph_format.space_after = Pt(6)
        _add_run(
            body,
            str(abstract),
            tb.get("abstract_font_size_pt", 10),
        )

    # Keywords
    keywords = frontmatter.get("keywords")
    if keywords:
        kp = doc.add_paragraph()
        kp.paragraph_format.first_line_indent = Cm(0)
        kp.paragraph_format.space_after = Pt(12)
        _add_run(
            kp,
            tb.get("keywords_label", "Keywords") + ": ",
            tb.get("abstract_font_size_pt", 10),
            bold=True,
        )
        if isinstance(keywords, list):
            sep = tb.get("keywords_separator", "; ")
            text = sep.join(str(k) for k in keywords)
        else:
            text = str(keywords)
        _add_run(kp, text, tb.get("abstract_font_size_pt", 10))


# ---------------------------------------------------------------------------
# Locale detection
# ---------------------------------------------------------------------------


_HANGUL_RE = re.compile(r"[\uac00-\ud7a3]")


def detect_locale(text: str) -> str:
    total = len(text) or 1
    hangul_count = len(_HANGUL_RE.findall(text))
    ratio = hangul_count / total
    if ratio > 0.05:
        return "ko"
    if ratio > 0.01:
        return "mixed"
    return "en"


# ===========================================================================
# Conversion entry point
# ===========================================================================


NOTICE_FILL = "FDECEA"
NOTICE_INK = RGBColor(0xA2, 0x1B, 0x12)


def _shade(element, fill: str) -> None:
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    element.append(shd)


def add_notice(doc, text: str) -> None:
    """The frontmatter `notice:` (e.g. "예시 데이터 — 수치는 가정입니다") as a tag in
    every page header, so an example document cannot be mistaken for a sourced one
    on any page it is printed from. A profile whose title page has its own, empty
    header (korean-generic) gets a tinted band under the title block instead."""
    if doc.sections[0].different_first_page_header_footer:
        band = doc.add_paragraph()
        band_run = band.add_run(str(text))
        band_run.bold = True
        band_run.font.size = Pt(10.5)
        band_run.font.color.rgb = NOTICE_INK
        band.paragraph_format.space_before = Pt(4)
        band.paragraph_format.space_after = Pt(14)
        _shade(band._p.get_or_add_pPr(), NOTICE_FILL)
    for index, section in enumerate(doc.sections):
        if index and section.header.is_linked_to_previous:
            continue
        header = section.header
        tag = header.paragraphs[0] if header.paragraphs and not header.paragraphs[0].text.strip() else header.add_paragraph()
        tag_run = tag.add_run(f"\u00a0{text}\u00a0")
        tag_run.bold = True
        tag_run.font.size = Pt(9)
        tag_run.font.color.rgb = NOTICE_INK
        _shade(tag_run._r.get_or_add_rPr(), NOTICE_FILL)


def add_plain_title_block(doc, front: dict) -> None:
    """Title, optional subtitle, and one line of author / organisation / date,
    left-aligned above the body, for the plain (non-publisher) profile."""
    title = doc.add_paragraph()
    run = title.add_run(str(front["title"]))
    run.bold = True
    run.font.size = Pt(22)
    title.paragraph_format.space_after = Pt(4)
    if front.get("subtitle"):
        sub_p = doc.add_paragraph()
        sub_run = sub_p.add_run(str(front["subtitle"]))
        sub_run.font.size = Pt(13)
        sub_run.font.color.rgb = RGBColor(0x55, 0x5F, 0x6D)
        sub_p.paragraph_format.space_after = Pt(4)
    authors = front.get("authors") or front.get("author")
    if isinstance(authors, list):
        authors = ", ".join(str(a.get("name", a)) if isinstance(a, dict) else str(a) for a in authors)
    meta = [str(v) for v in (authors, front.get("organization"), front.get("date")) if v]
    if meta:
        meta_p = doc.add_paragraph()
        meta_run = meta_p.add_run(" · ".join(meta))
        meta_run.font.size = Pt(10.5)
        meta_run.font.color.rgb = RGBColor(0x55, 0x5F, 0x6D)
        meta_p.paragraph_format.space_after = Pt(18)
    if front.get("notice"):
        add_notice(doc, front["notice"])


def read_source(md_path: Path) -> str:
    """The Markdown source, with {{ … }} numbers filled from its `data:` files
    (lib/office_data.py computes derived values and runs the declared checks)."""
    text = md_path.read_text(encoding="utf-8")
    try:
        return resolve_text(text, md_path.parent)[0]
    except DataError as exc:
        raise SystemExit(f"Data error: {exc}") from exc


def convert_md_to_docx(
    md_path: Path,
    docx_path: Path,
    template_path: Path = None,
    publisher_name: str | None = None,
    registry_path: Path | None = None,
    locale: str = "auto",
):
    """Convert Markdown file to DOCX.

    When publisher_name is None, behavior is byte-compatible with the pre-M1
    script: read md, convert to HTML, html_to_docx, save. Regression-guarded.

    When publisher_name is set, apply the full journal pipeline: registry
    load, frontmatter parse, pre-MD filters, title-block injection, post-HTML
    heading numbering, booktabs tables, banned stripping, CJK font pairing.
    """
    if publisher_name is None:
        # --- Legacy code path (regression-critical: do not mutate) ---
        md_text = read_source(md_path)
        # A frontmatter block is a title page request, not body text: strip it and
        # set a plain title block. Markdown without frontmatter converts as before.
        plain_front = {}
        if md_text.startswith("---"):
            plain_front, md_text = parse_frontmatter(md_text)
        md_converter = markdown.Markdown(extensions=[
            'tables',
            'fenced_code',
            'nl2br',
            'sane_lists',
        ])
        html = md_converter.convert(md_text)
        if template_path and template_path.exists():
            doc = Document(str(template_path))
        else:
            doc = Document()
        if plain_front.get("title"):
            add_plain_title_block(doc, plain_front)
        html_to_docx(html, doc, md_path)
        doc.save(str(docx_path))
        print(f"Successfully converted {md_path} to {docx_path}")
        return

    # --- Journal workflow ---
    script_dir = Path(__file__).resolve().parent
    registry_path = registry_path or (script_dir.parent / "templates" / "registry.yaml")
    publisher = load_publisher(Path(registry_path), publisher_name)
    design = publisher["design"]
    docx_font = publisher["docx"]["font"]

    md_text = read_source(md_path)
    frontmatter, body = parse_frontmatter(md_text)

    # Locale detection (informational in M1; Korean rules land in M6)
    detected_locale = detect_locale(body) if locale == "auto" else locale

    # Pre-MD micro-typography filters
    dash_rules = design.get("micro_typography", {}).get("dashes")
    body = fix_dashes(body, dash_rules)
    body = fix_quotes(body)
    body = fix_unit_spacing(body)
    body = fix_ellipsis(body)
    body = normalize_double_spaces(body)

    # Load template if available
    template_docx = script_dir.parent / "templates" / "docx" / f"{publisher_name}.docx"
    if template_docx.exists():
        doc = Document(str(template_docx))
        # The template includes a self-describing sample title block and
        # sample heading/body paragraph. Strip all existing body paragraphs
        # and tables so the conversion output is the user's content only.
        body_el = doc.element.body
        sect_pr = body_el.find(qn("w:sectPr"))
        for child in list(body_el):
            if child is sect_pr:
                continue
            body_el.remove(child)
        if sect_pr is None:
            pass  # keep original body even if no sectPr detected
    elif template_path and template_path.exists():
        doc = Document(str(template_path))
    else:
        doc = Document()

    # Title block (built from frontmatter) before main content
    if frontmatter.get("title"):
        inject_title_block(doc, frontmatter, design)
    if frontmatter.get("notice"):
        add_notice(doc, frontmatter["notice"])

    # Main content
    md_converter = markdown.Markdown(extensions=[
        'tables',
        'fenced_code',
        'nl2br',
        'sane_lists',
    ])
    html = md_converter.convert(body)
    html_to_docx(html, doc, md_path)

    # Post-HTML design enforcement
    apply_heading_numbering(doc, design)
    apply_table_style(doc, design)
    strip_banned(doc, design)
    apply_cjk_font_pairing(doc, docx_font)

    doc.save(str(docx_path))
    print(
        f"Successfully converted {md_path} to {docx_path} "
        f"[publisher={publisher_name}, locale={detected_locale}]"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Markdown to DOCX with proper styling"
    )
    parser.add_argument("input", help="Input Markdown file")
    parser.add_argument("output", help="Output DOCX file")
    parser.add_argument(
        "--template",
        help="Optional DOCX template to use as base",
        default=None,
    )
    parser.add_argument(
        "--publisher",
        help="Journal publisher profile from templates/registry.yaml (e.g. elsevier)",
        default=None,
    )
    parser.add_argument(
        "--registry",
        help="Path to templates/registry.yaml (defaults to the one in this skill)",
        default=None,
    )
    parser.add_argument(
        "--locale",
        choices=("auto", "en", "ko", "mixed"),
        default="auto",
        help="Force locale; 'auto' detects via Hangul codepoint ratio",
    )
    args = parser.parse_args()
    if args.publisher and args.template:
        parser.error("--publisher and --template are mutually exclusive")
    return args


def main() -> int:
    args = parse_args()

    md_path = Path(args.input).expanduser().resolve()
    docx_path = Path(args.output).expanduser().resolve()
    template_path = Path(args.template).expanduser().resolve() if args.template else None
    registry_path = Path(args.registry).expanduser().resolve() if args.registry else None

    if not md_path.exists():
        print(f"Error: Input file not found: {md_path}")
        return 1

    convert_md_to_docx(
        md_path, docx_path, template_path,
        publisher_name=args.publisher,
        registry_path=registry_path,
        locale=args.locale,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
