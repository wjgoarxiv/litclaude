"""The `mark` setting for LitClaude's Python engines (lit-docx, lit-pptx); the same rules as mark.mjs.

`on` puts an invisible generator tag in every output and a visible mark on showcase outputs, `meta` keeps only
the invisible tag, `off` leaves outputs unmarked. The value lives in `<litHome>/config.json` (litHome is
LITCLAUDE_HOME or ~/.litclaude); LITCLAUDE_MARK overrides it for one run; anything unreadable reads as `on`.
No network, no clock.
"""

from __future__ import annotations

import json
import os
import re
import zipfile
from pathlib import Path

MARK_MODES = ("on", "meta", "off")
_MAX_CONFIG_BYTES = 64 * 1024
_MANIFEST = Path(__file__).resolve().parent.parent / ".claude-plugin" / "plugin.json"


def _config_path() -> Path:
    home = os.environ.get("LITCLAUDE_HOME") or str(Path.home() / ".litclaude")
    return Path(home).resolve() / "config.json"


def _stored() -> str | None:
    path = _config_path()
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > _MAX_CONFIG_BYTES:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data.get("mark") if isinstance(data, dict) else None


def mode() -> str:
    """The mode for this run: LITCLAUDE_MARK when valid, else the stored value, else `on`."""
    override = os.environ.get("LITCLAUDE_MARK", "").strip().lower()
    if override in MARK_MODES:
        return override
    stored = _stored()
    return stored if stored in MARK_MODES else "on"


def generator() -> str:
    """`LitClaude <version> · github.com/wjgoarxiv/litclaude`, the version taken from the plugin manifest."""
    version = json.loads(_MANIFEST.read_text(encoding="utf-8"))["version"]
    return f"LitClaude {version} · github.com/wjgoarxiv/litclaude"


def meta_generator() -> str | None:
    """The generator string when this run tags outputs (`on` or `meta`), else None."""
    return None if mode() == "off" else generator()


CUSTOM_PART = "docProps/custom.xml"
_CUSTOM_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml"
_CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties"
_FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"


def _xml_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def tag_ooxml_parts(parts: dict[str, str], gen: str) -> dict[str, str]:
    """Return the changed package parts that name `gen`: app.xml <Application> and a custom `Generator`
    property, with the content type and package relationship custom.xml needs. Other parts are untouched."""
    text = _xml_text(gen)
    out: dict[str, str] = {}
    app = parts.get("docProps/app.xml")
    if app is not None:
        tag = f"<Application>{text}</Application>"
        out["docProps/app.xml"] = re.sub(r"<Application>[^<]*</Application>|<Application/>", tag, app, count=1) \
            if re.search(r"<Application[>/]", app) else app.replace("</Properties>", tag + "</Properties>", 1)
    prop = f'<vt:lpwstr>{text}</vt:lpwstr></property>'
    custom = parts.get(CUSTOM_PART)
    if custom is None:
        out[CUSTOM_PART] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
                            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
                            f'<property fmtid="{_FMTID}" pid="2" name="Generator">{prop}</Properties>')
    else:
        existing = re.search(r'(<property [^>]*name="Generator"[^>]*>)[\s\S]*?</property>', custom)
        if existing:
            out[CUSTOM_PART] = custom.replace(existing.group(0), existing.group(1) + prop, 1)
        else:
            pid = max([int(p) for p in re.findall(r'\bpid="(\d+)"', custom)] or [1]) + 1
            out[CUSTOM_PART] = custom.replace("</Properties>", f'<property fmtid="{_FMTID}" pid="{pid}" name="Generator">{prop}</Properties>', 1)
    types = parts["[Content_Types].xml"]
    if f'PartName="/{CUSTOM_PART}"' not in types:
        out["[Content_Types].xml"] = types.replace("</Types>", f'<Override PartName="/{CUSTOM_PART}" ContentType="{_CUSTOM_TYPE}"/></Types>', 1)
    rels = parts["_rels/.rels"]
    if f'Target="{CUSTOM_PART}"' not in rels and f'Target="/{CUSTOM_PART}"' not in rels:
        ids = [int(i) for i in re.findall(r'Id="rId(\d+)"', rels)]
        rid = f"rId{max(ids or [0]) + 1}"
        out["_rels/.rels"] = rels.replace("</Relationships>", f'<Relationship Id="{rid}" Type="{_CUSTOM_REL}" Target="{CUSTOM_PART}"/></Relationships>', 1)
    return out


def tag_ooxml(path: Path | str) -> None:
    """Tag a written .docx/.pptx in place when the mode is `on` or `meta`; `off` leaves the file as written."""
    gen = meta_generator()
    if gen is None:
        return
    path = Path(path)
    names = ("docProps/app.xml", CUSTOM_PART, "[Content_Types].xml", "_rels/.rels")
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        data = {i.filename: z.read(i.filename) for i in infos}
    changed = tag_ooxml_parts({n: data[n].decode("utf-8") for n in names if n in data}, gen)
    tmp = path.with_name(path.name + ".mark.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        for info in infos:
            body = changed[info.filename].encode("utf-8") if info.filename in changed else data[info.filename]
            out.writestr(info, body, compress_type=zipfile.ZIP_DEFLATED)
        if CUSTOM_PART not in data:
            out.writestr(CUSTOM_PART, changed[CUSTOM_PART].encode("utf-8"))
    os.replace(tmp, path)


def tag_latex(tex: str, gen: str | None) -> str:
    """Add a dvipdfmx docinfo special (Creator and Producer, UTF-16 hex) right after \\begin{document}.
    It runs after hyperref's begin-document hooks, so it is the value that lands in the PDF."""
    if gen is None or "\\begin{document}" not in tex:
        return tex
    hexed = "FEFF" + gen.encode("utf-16-be").hex().upper()
    special = f"\\special{{pdf:docinfo<</Creator<{hexed}>/Producer<{hexed}>>>}}%\n"
    head, tail = tex.split("\\begin{document}", 1)
    return head + "\\begin{document}\n" + special + tail.removeprefix("\n")
