"""Read a .docx back into JSON for the lit-docx tests: sections, fonts, body blocks in order
(paragraphs and tables with the properties the tonality engine sets), headers and footers.

    python docx_probe.py out.docx
"""
import json
import re
import sys
import zipfile

from docx import Document

sys.dont_write_bytecode = True
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def val(el, path, attr="val"):
    found = el.find(path) if el is not None else None
    return found.get(W + attr) if found is not None else None


def borders(el):
    out = {}
    if el is None:
        return out
    for side in ("top", "bottom", "left", "right", "insideH", "insideV"):
        b = el.find(W + side)
        if b is not None and b.get(W + "val") not in ("nil", "none"):
            out[side] = {"sz": int(b.get(W + "sz", "0")), "color": b.get(W + "color")}
    return out


def runs(p):
    out = []
    for r in p.iter(W + "r"):
        text = "".join(t.text or "" for t in r.iter(W + "t"))
        if not text and r.find(W + "tab") is None:
            continue
        rpr = r.find(W + "rPr")
        size = val(rpr, W + "sz")
        out.append({"text": text, "bold": rpr is not None and rpr.find(W + "b") is not None and val(rpr, W + "b") not in ("0", "false"),
                    "color": val(rpr, W + "color"), "size": int(size) / 2 if size else None,
                    "fonts": dict((k, val(rpr, W + "rFonts", k)) for k in ("ascii", "eastAsia")) if rpr is not None and rpr.find(W + "rFonts") is not None else None})
    return out


def para(p, styles):
    ppr = p.find(W + "pPr")
    sid = val(ppr, W + "pStyle")
    ind = ppr.find(W + "ind") if ppr is not None else None
    return {
        "t": "p", "style": styles.get(sid, sid), "text": "".join(t.text or "" for t in p.iter(W + "t")),
        "runs": runs(p), "pBdr": borders(ppr.find(W + "pBdr") if ppr is not None else None),
        "shd": val(ppr, W + "shd", "fill"), "keepNext": ppr is not None and ppr.find(W + "keepNext") is not None,
        "pageBreakBefore": ppr is not None and ppr.find(W + "pageBreakBefore") is not None,
        "hanging": int(ind.get(W + "hanging")) / 20 if ind is not None and ind.get(W + "hanging") else 0,
        "columnBreak": p.find(f".//{W}br[@{W}type='column']") is not None,
        "sect": ppr is not None and ppr.find(W + "sectPr") is not None,
        "image": p.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip") is not None,
    }


def table(t, styles):
    tpr = t.find(W + "tblPr")
    rows = t.findall(W + "tr")
    cell_text = [["".join(x.text or "" for x in tc.iter(W + "t")) for tc in tr.findall(W + "tc")] for tr in rows]
    fills = [[val(tc.find(W + "tcPr"), W + "shd", "fill") for tc in tr.findall(W + "tc")] for tr in rows]
    first_tc = rows[0].find(W + "tc") if rows else None
    tc_borders = borders(first_tc.find(f"{W}tcPr/{W}tcBorders")) if first_tc is not None else {}
    sizes = [int(s.get(W + "val")) / 2 for s in t.iter(W + "sz")]
    keep = sum(1 for tr in rows[:-1] if tr.find(f"{W}tc/{W}p/{W}pPr/{W}keepNext") is not None)
    return {"t": "tbl", "caption": val(tpr, W + "tblCaption"), "style": val(tpr, W + "tblStyle"),
            "float": val(tpr, W + "tblpPr", "tblpXSpec"), "borders": borders(tpr.find(W + "tblBorders") if tpr is not None else None),
            "rows": cell_text, "fills": fills, "firstCellBorders": tc_borders, "minSize": min(sizes) if sizes else None,
            "header": rows[0].find(f"{W}trPr/{W}tblHeader") is not None if rows else False,
            "cantSplit": sum(1 for tr in rows if tr.find(f"{W}trPr/{W}cantSplit") is not None), "n": len(rows), "keepRows": keep,
            "keepLast": bool(rows) and rows[-1].find(f"{W}tc/{W}p/{W}pPr/{W}keepNext") is not None,
            "inner": [table(x, styles)["caption"] for x in t.iter(W + "tbl") if x is not t]}


def section(s):
    sz, mg, cols = s.find(W + "pgSz"), s.find(W + "pgMar"), s.find(W + "cols")
    tw = lambda e, k: int(e.get(W + k, "0")) if e is not None else 0  # noqa: E731
    return {"w": tw(sz, "w") / 20, "h": tw(sz, "h") / 20,
            "margins_mm": [round(tw(mg, k) / 56.693, 1) for k in ("top", "bottom", "left", "right")],
            "cols": int(cols.get(W + "num", "1")) if cols is not None else 1, "sep": cols is not None and cols.get(W + "sep") in ("1", "true"),
            "type": val(s, W + "type"), "titlePg": s.find(W + "titlePg") is not None, "pgNumStart": val(s, W + "pgNumType", "start")}


def main(path):
    doc = Document(path)
    z = zipfile.ZipFile(path)
    styles = {st.style_id: st.name for st in doc.styles}
    body = doc.element.body
    blocks = []
    for el in body:
        if el.tag == W + "p":
            blocks.append(para(el, styles))
        elif el.tag == W + "tbl":
            blocks.append(table(el, styles))
    st_xml = z.read("word/styles.xml").decode()
    defaults = re.search(r"<w:rPrDefault>.*?</w:rPrDefault>", st_xml, re.S)
    fonts = {}
    for st in doc.styles:
        rpr = st.element.find(W + "rPr")
        rf = rpr.find(W + "rFonts") if rpr is not None else None
        if rf is not None:
            fonts[st.name] = {k: rf.get(W + k) for k in ("ascii", "hAnsi", "eastAsia", "cs", "asciiTheme", "eastAsiaTheme") if rf.get(W + k)}
    sizes = {}
    for name in ("Normal", "Heading 1", "Heading 2", "Heading 3", "Caption"):
        try:
            f = doc.styles[name].font
            sizes[name] = f.size.pt if f.size else None
        except KeyError:
            pass
    theme = []
    for name in z.namelist():
        if re.match(r"word/theme/theme\d+\.xml$", name):
            x = z.read(name).decode()
            theme += re.findall(r'<a:(?:latin|ea) typeface="([^"]*)"', x)
    numbering = []
    if "word/numbering.xml" in z.namelist():
        numbering = sorted(set(re.findall(r'w:ascii="([^"]+)"', z.read("word/numbering.xml").decode())))
    parts = []
    for i, s in enumerate(doc.sections):
        for kind, hf in (("header", s.header), ("first_header", s.first_page_header), ("footer", s.footer), ("first_footer", s.first_page_footer)):
            if hf.is_linked_to_previous:
                continue
            xml = hf._element.xml
            parts.append({"section": i, "kind": kind, "text": "\n".join(p.text for p in hf.paragraphs),
                          "fields": sorted(set(re.findall(r"(PAGE|NUMPAGES|STYLEREF)", xml))),
                          "shd": re.findall(r'w:fill="([0-9A-Fa-f]{6})"', xml), "pBdr": "w:pBdr" in xml})
    print(json.dumps({
        "sections": [section(s._sectPr) for s in doc.sections],
        "defaults": dict(re.findall(r'w:(ascii|hAnsi|eastAsia|cs)="([^"]+)"', (re.search(r"<w:rFonts [^>]*>", defaults.group(0)) or [""])[0])) if defaults else {},
        "defaults_theme": bool(defaults and "Theme=" in defaults.group(0)),
        "style_fonts": fonts, "sizes": sizes, "theme": sorted(set(theme)), "numbering": numbering,
        "blocks": blocks, "hf": parts,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
