"use strict";

/**
 * template-registry.js — Load enrolled templates from YAML files.
 *
 * Reads template.yaml, layout-mapping.yaml, and capabilities.yaml from
 * enrolled template directories under templates/enrolled/<NAME>/.
 */

const fs = require("fs");
const path = require("path");

const ENROLLED_DIR = path.resolve(__dirname, "../../templates/enrolled");

/**
 * Where templates are looked up, first match wins: every directory in
 * LIT_PPTX_TEMPLATE_DIRS (path-delimiter separated), then .lit-pptx/templates
 * under the working directory (learn_template.py writes there by default),
 * then the templates bundled with the skill. The installed skill directory is
 * read-only, so a learned template never has to be written into it.
 */
function templateDirs() {
  const extra = (process.env.LIT_PPTX_TEMPLATE_DIRS || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.resolve(dir));
  return [...extra, path.resolve(process.cwd(), ".lit-pptx", "templates"), ENROLLED_DIR];
}

/**
 * Minimal YAML parser for the project's template files.
 * Handles nested mappings, lists, quoted strings, and numeric values.
 * @param {string} raw — YAML source text
 * @returns {object}
 */
function parseYaml(raw) {
  const lines = raw.split("\n");
  return parseBlock(lines, 0, 0).value;
}

/**
 * Parse a YAML block starting at `startLine` with indentation >= `minIndent`.
 * Returns { value, nextLine } where nextLine is the first line NOT consumed.
 */
function parseBlock(lines, startLine, minIndent) {
  // Determine if this is a mapping or a sequence
  let i = startLine;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    break;
  }

  if (i >= lines.length) {
    return { value: {}, nextLine: i };
  }

  const firstNonEmpty = lines[i];
  const firstIndent = firstNonEmpty.length - firstNonEmpty.trimStart().length;

  // Check if sequence or mapping
  const firstTrimmed = firstNonEmpty.trim();
  if (firstTrimmed.startsWith("- ") || firstTrimmed === "-") {
    return parseSequence(lines, i, firstIndent);
  }
  return parseMapping(lines, i, minIndent);
}

/**
 * Parse a YAML mapping (key: value pairs).
 */
function parseMapping(lines, startLine, minIndent) {
  const result = {};
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blanks and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < minIndent) break;

    // Must be a key: value line
    const kvMatch = trimmed.match(/^([\w][\w.-]*):\s*(.*)$/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    const valPart = kvMatch[2].trim();

    if (valPart === "") {
      // Value is on next indented lines — check if it's a sequence or mapping
      let nextI = i + 1;
      while (nextI < lines.length) {
        const t = lines[nextI].trim();
        if (t === "" || t.startsWith("#")) {
          nextI++;
          continue;
        }
        break;
      }
      if (nextI >= lines.length) {
        result[key] = null;
        i = nextI;
        continue;
      }

      const childIndent = lines[nextI].length - lines[nextI].trimStart().length;
      if (childIndent <= indent) {
        result[key] = null;
        i++;
        continue;
      }

      const childTrimmed = lines[nextI].trim();
      if (childTrimmed.startsWith("- ") || childTrimmed === "-") {
        const seq = parseSequence(lines, nextI, childIndent);
        result[key] = seq.value;
        i = seq.nextLine;
      } else {
        const sub = parseMapping(lines, nextI, childIndent);
        result[key] = sub.value;
        i = sub.nextLine;
      }
    } else {
      result[key] = parseScalar(valPart);
      i++;
    }
  }

  return { value: result, nextLine: i };
}

/**
 * Parse a YAML sequence (list of items starting with -).
 */
function parseSequence(lines, startLine, minIndent) {
  const result = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < minIndent) break;
    if (indent !== minIndent) break;

    if (trimmed.startsWith("- ")) {
      const itemPart = trimmed.slice(2).trim();
      if (itemPart === "") {
        i++;
        continue;
      }

      // Check if item is a key: value (inline mapping start)
      const kvMatch = itemPart.match(/^([\w][\w.-]*):\s*(.*)$/);
      if (kvMatch) {
        // This is an inline mapping as a list item
        const inlineObj = {};
        const k = kvMatch[1];
        const v = kvMatch[2].trim();

        if (v === "") {
          // Multi-line mapping value in a list item
          let nextI = i + 1;
          while (nextI < lines.length) {
            const t = lines[nextI].trim();
            if (t === "" || t.startsWith("#")) {
              nextI++;
              continue;
            }
            break;
          }

          if (nextI < lines.length) {
            const childIndent = lines[nextI].length - lines[nextI].trimStart().length;
            if (childIndent > indent + 2) {
              const sub = parseMapping(lines, nextI, childIndent);
              inlineObj[k] = sub.value;
              i = sub.nextLine;
              // Continue parsing more keys at indent + 2
              while (i < lines.length) {
                const tl = lines[i].trim();
                if (tl === "" || tl.startsWith("#")) { i++; continue; }
                const ci = lines[i].length - lines[i].trimStart().length;
                if (ci < childIndent) break;
                const km = tl.match(/^([\w][\w.-]*):\s*(.*)$/);
                if (!km) break;
                const ck = km[1];
                const cv = km[2].trim();
                if (cv === "") {
                  let nI = i + 1;
                  while (nI < lines.length) {
                    const tt = lines[nI].trim();
                    if (tt === "" || tt.startsWith("#")) { nI++; continue; }
                    break;
                  }
                  if (nI < lines.length) {
                    const cci = lines[nI].length - lines[nI].trimStart().length;
                    if (cci > ci) {
                      const sub2 = parseMapping(lines, nI, cci);
                      inlineObj[ck] = sub2.value;
                      i = sub2.nextLine;
                      continue;
                    }
                  }
                  inlineObj[ck] = null;
                  i++;
                  continue;
                }
                inlineObj[ck] = parseScalar(cv);
                i++;
              }
            } else {
              inlineObj[k] = null;
            }
          } else {
            inlineObj[k] = null;
          }
        } else {
          inlineObj[k] = parseScalar(v);
          i++;
        }

        // Check for more key: value pairs at the same continuation indent
        const contIndent = indent + 2;
        while (i < lines.length) {
          const cline = lines[i];
          const ct = cline.trim();
          if (ct === "" || ct.startsWith("#")) { i++; continue; }
          const ci = cline.length - cline.trimStart().length;
          if (ci < contIndent) break;
          // Must be at the continuation indent level
          const ckm = ct.match(/^([\w][\w.-]*):\s*(.*)$/);
          if (!ckm) break;
          const ck = ckm[1];
          const cv = ckm[2].trim();
          if (cv === "") {
            let nI = i + 1;
            while (nI < lines.length) {
              const tt = lines[nI].trim();
              if (tt === "" || tt.startsWith("#")) { nI++; continue; }
              break;
            }
            if (nI < lines.length) {
              const nci = lines[nI].length - lines[nI].trimStart().length;
              if (nci > ci) {
                const sub2 = parseMapping(lines, nI, nci);
                inlineObj[ck] = sub2.value;
                i = sub2.nextLine;
                continue;
              }
            }
            inlineObj[ck] = null;
            i++;
            continue;
          }
          inlineObj[ck] = parseScalar(cv);
          i++;
        }

        result.push(inlineObj);
      } else {
        result.push(parseScalar(itemPart));
        i++;
      }
    } else if (trimmed === "-") {
      i++;
    } else {
      break;
    }
  }

  return { value: result, nextLine: i };
}

/**
 * Drop a trailing YAML comment (whitespace, then `#`) from a scalar. A quoted
 * value ends at its closing quote, so a `#` inside the quotes stays. Without
 * this, `char_spacing: -0.5   # note` parsed as a string and every run of the
 * template was written with spc="NaN".
 */
function stripInlineComment(raw) {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    const close = raw.indexOf(quote, 1);
    if (close > 0 && /^\s+#/.test(raw.slice(close + 1))) return raw.slice(0, close + 1);
    return raw;
  }
  return raw.replace(/\s+#.*$/, "");
}

/**
 * Parse a scalar YAML value (string, number, boolean, null).
 */
function parseScalar(raw) {
  raw = stripInlineComment(raw);
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Quoted string
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Inline array: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => parseScalar(s.trim()));
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return parseFloat(raw);
  }

  return raw;
}

/**
 * List available enrolled template names.
 * @returns {string[]}
 */
function listTemplates() {
  const names = new Set();
  for (const dir of templateDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (fs.statSync(path.join(dir, name)).isDirectory()) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Load an enrolled template by name.
 * @param {string} name — Template directory name (e.g. "MY-BRAND")
 * @returns {{ name: string, version: string, template: object, mapping: object, capabilities: object }}
 */
function loadTemplate(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(name))) {
    throw new Error(`Invalid template name: "${name}"`);
  }
  const dir = templateDirs()
    .map((base) => path.join(base, name))
    .find((candidate) => fs.existsSync(path.join(candidate, "template.yaml")));
  if (!dir) {
    throw new Error(`Unknown template: "${name}" not found in ${templateDirs().join(", ")}`);
  }

  const readFile = (basename) => {
    const fp = path.join(dir, basename);
    if (!fs.existsSync(fp)) {
      throw new Error(`Template "${name}" is missing ${basename}`);
    }
    return fs.readFileSync(fp, "utf-8");
  };

  const template = parseYaml(readFile("template.yaml"));
  const mapping = parseYaml(readFile("layout-mapping.yaml"));
  const capabilities = parseYaml(readFile("capabilities.yaml"));

  return {
    name: template.name || name,
    version: template.version || "0.0.0",
    template,
    mapping,
    capabilities,
  };
}

module.exports = { loadTemplate, listTemplates };
