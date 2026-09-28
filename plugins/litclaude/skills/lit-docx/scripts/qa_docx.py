#!/usr/bin/env python3
"""qa_docx.py — one pass/fail gate for a generated .docx and its Markdown source.

The document counterpart of lit-pptx's qa_deck.py. It combines:

  1. Integrity  — plugins/litclaude/lib/ooxml_integrity.py (the package opens,
                  relationships resolve, no NaN attribute values, python-docx reopens)
  2. Prose lint — slop_lint rules on the Markdown source (AI-tell phrases, hedging
                  pile-ups, stock openers/closers, adjective stacks, Korean rules);
                  --kind report drops the journal-manuscript outline rules
  3. Design     — slop_lint's DOCX audit (banned fonts, profile margins, booktabs
                  tables, highlights, tracked changes, ASCII ellipsis) and the Hangul
                  eastAsia font pairing check
  4. Content    — the document has body text, every Markdown heading reached it, no
                  unfilled blank ([제품명], [금액], XXX, TBD, ○○, {{…}}) is left, and
                  no YAML frontmatter leaked into the body

Rendering is separate (visual_audit.py) because it needs soffice; a clean gate
is defect-absence, not a verdict on how the pages read.

Usage:
    python3 qa_docx.py out.docx --source draft.md --publisher korean-generic [--kind report]
    python3 qa_docx.py out.docx --source draft.md                       # plain profile

Prints JSON; exit 0 on PASS, 1 on FAIL.
"""

from __future__ import annotations

import os as _os
import sys as _sys

_sys.dont_write_bytecode = True  # the installed skill directory stays read-only
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", "lib"))
from office_runtime_bootstrap import ensure_runtime  # noqa: E402

ensure_runtime(["docx", "markdown", "bs4", "yaml"])

import argparse  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
from pathlib import Path  # noqa: E402

from docx import Document  # noqa: E402
from ooxml_integrity import check_package  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent
_sys.path.insert(0, str(SCRIPT_DIR))
import slop_lint  # noqa: E402

HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
# A bracket with a digit in it is a citation marker ([1], [S3]); a blank has none.
PLACEHOLDER = re.compile(
    r"\[(?![^\]\n]*\d)[^\]\n]{1,24}\]|\bX{3,}\b|\bTBD\b|\bTODO\b|○○|OOO|\{\{[^}]*\}\}|_{4,}|＿{2,}"
)
FRONTMATTER_LEAK = re.compile(r"^(?:---|title:|author:|authors:|date:|subtitle:)\s*", re.M)


def source_headings(markdown_text: str) -> list[str]:
    headings, in_fence = [], False
    for line in markdown_text.splitlines():
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        match = None if in_fence else HEADING.match(line)
        if match:
            headings.append(re.sub(r"[*_`]", "", match.group(2)).strip())
    return headings


def check_content(docx_path: Path, markdown_text: str | None) -> dict:
    document = Document(str(docx_path))
    paragraphs = [p.text.strip() for p in document.paragraphs if p.text.strip()]
    body_chars = sum(len(p) for p in paragraphs) + sum(
        len(cell.text) for table in document.tables for row in table.rows for cell in row.cells
    )
    cells = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
    blanks = sorted({m.group(0) for text in paragraphs + cells for m in PLACEHOLDER.finditer(text)})
    leaked = [p for p in paragraphs[:8] if FRONTMATTER_LEAK.match(p)]
    missing = []
    if markdown_text:
        text = "\n".join(paragraphs)
        for heading in source_headings(markdown_text):
            if heading not in text:
                missing.append(heading)
    return {
        "pass": body_chars > 0 and not missing and not blanks and not leaked,
        "placeholders": blanks[:20],
        "frontmatter_leak": leaked[:4],
        "paragraphs": len(paragraphs),
        "tables": len(document.tables),
        "body_chars": body_chars,
        "missing_headings": missing[:20],
    }


def lint(source: Path | None, docx_path: Path, publisher_name: str, kind: str) -> dict:
    registry = SCRIPT_DIR.parent / "templates" / "registry.yaml"
    phrase_rules = slop_lint.load_phrase_rules(SCRIPT_DIR.parent / "references" / "slop_phrase_list.yaml")
    publisher = slop_lint.load_publisher(registry, publisher_name)
    findings = []
    locale = "auto"
    if source is not None:
        found, _front, _body, locale = slop_lint.lint_text(source.read_text(encoding="utf-8"), publisher, phrase_rules, "auto")
        findings.extend(found)
        if kind == "report":
            findings = [f for f in findings if f.rule_id not in slop_lint.MANUSCRIPT_ONLY_RULES]
    design = slop_lint.audit_docx_design(docx_path, publisher)
    if locale in {"ko", "mixed"} or source is None:
        design.extend(slop_lint.audit_docx_cjk(docx_path))
    craft_blocking, craft_advisory = slop_lint.audit_docx_craft(docx_path)
    design.extend(craft_blocking)
    as_dict = lambda f: {"rule": f.rule_id, "line": f.line, "section": f.section, "message": f.message, "excerpt": f.excerpt}  # noqa: E731
    return {
        "pass": not findings and not design,
        "locale": locale,
        "prose": [as_dict(f) for f in findings][:40],
        "design": [as_dict(f) for f in design][:40],
        "advisories": [as_dict(f) for f in craft_advisory][:40],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pass/fail gate for a generated DOCX.")
    parser.add_argument("docx", type=Path)
    parser.add_argument("--source", type=Path, default=None, help="Markdown the DOCX was built from")
    parser.add_argument(
        "--publisher",
        default=None,
        help="Profile the DOCX was built with (korean-generic, elsevier, acs, ieee, nature). Omit for the plain profile.",
    )
    parser.add_argument("--kind", choices=("report", "manuscript"), default="report")
    args = parser.parse_args(argv)

    docx_path = args.docx.expanduser().resolve()
    source = args.source.expanduser().resolve() if args.source else None
    integrity = check_package(docx_path)
    content = check_content(docx_path, source.read_text(encoding="utf-8") if source else None) if integrity["pass"] else {"pass": False}
    # The plain profile has no registry entry; its prose is still linted with the
    # korean-generic phrase rules, and the design audit is limited to what every
    # profile shares.
    lint_report = lint(source, docx_path, args.publisher or "korean-generic", args.kind) if integrity["pass"] else {"pass": False}
    if args.publisher is None and lint_report.get("design"):
        shared = {"rule-45-highlighted-text", "rule-46-tracked-changes", "rule-55-ellipsis", "rule-60-numeric-column-alignment"}
        lint_report["design"] = [f for f in lint_report["design"] if f["rule"] in shared]
        lint_report["pass"] = not lint_report["prose"] and not lint_report["design"]

    reasons = []
    if not integrity["pass"]:
        reasons.append("integrity: " + "; ".join(integrity["problems"][:5]))
    if content.get("placeholders"):
        reasons.append(f"content: unfilled blanks {content['placeholders'][:5]} — fill them with realistic values and label them as examples or assumptions")
    if content.get("frontmatter_leak"):
        reasons.append("content: YAML frontmatter printed as body text — convert with the converter that reads frontmatter")
    if not content.get("pass") and not content.get("placeholders") and not content.get("frontmatter_leak"):
        reasons.append("content: empty document or headings missing from the output")
    if lint_report.get("prose"):
        reasons.append(f"prose lint: {len(lint_report['prose'])} finding(s)")
    if lint_report.get("design"):
        reasons.append(f"design audit: {len(lint_report['design'])} finding(s)")

    report = {
        "file": str(docx_path),
        "pass": not reasons,
        "failure_reasons": reasons,
        "profile": args.publisher or "plain",
        "kind": args.kind,
        "integrity": {"pass": integrity["pass"], "problems": integrity["problems"][:20]},
        "content": content,
        "lint": lint_report,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
