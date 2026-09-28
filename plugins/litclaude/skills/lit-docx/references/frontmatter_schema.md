# Frontmatter schema

Use a YAML block at the top of the Markdown source.

```yaml
---
title: "Catalytic CO2 reduction on Cu/ZnO: a mechanistic study"
authors:
  - { name: "Woojin Go", affiliation: 1, corresponding: true }
  - { name: "Jane Doe", affiliation: [1, 2] }
affiliations:
  1: "Department of Chemical Engineering, University X"
  2: "Advanced Materials Institute, University Y"
abstract: "We report ..."
keywords: [CO2 reduction, Cu/ZnO, DFT, operando XPS]
funding: "Optional funding statement"
corresponding_email: "wj@example.ac.kr"
journal_target: "elsevier"
---
```

## Field matrix

| Field | Type | Required by journal DOCX path | Used by lint/report path |
|---|---|---|---|
| `title` | string | yes | yes |
| `authors` | list[object] | yes | yes |
| `affiliations` | mapping | yes | no |
| `abstract` | string | yes | yes |
| `keywords` | list/string | yes | yes |
| `corresponding_email` | string | recommended | checklist only |
| `funding` | string | optional | checklist only |
| `journal_target` | string | optional | report context only |

## Consumed fields by workflow

- `convert_md_to_docx.py --publisher ...`
  - title, authors, affiliations, abstract, keywords, corresponding_email
- `slop_lint.py`
  - title, authors, abstract, keywords, corresponding_email, funding, journal_target
- `convert_md_to_pdf.py` (optional)
  - title, authors, affiliations, abstract, keywords, corresponding_email
