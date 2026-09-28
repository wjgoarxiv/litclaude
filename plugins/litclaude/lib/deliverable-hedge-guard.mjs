import { lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, isAbsolute, relative, resolve } from "node:path";

import { extractCreatedDocumentPaths, extractMutatedFilePaths } from "./mutated-file-paths.mjs";
import { readRegularStable } from "./secure-path-read.mjs";
import { extractArtifactText } from "../skills/lit-humanizer/scripts/artifact-text.mjs";

const MAX_ARTIFACT_BYTES = 512 * 1024;
const MAX_AGGREGATE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_PATHS = 16;
const MAX_POST_CREATE_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_LINES = 50_000;
const MAX_DIFF_TRACE_CELLS = 500_000;
const MAX_DIFF_WORK = 8_000_000;
const SCANNER_TIMEOUT_MS = 2000;
const TEXT_EXTENSIONS = new Set([
  ".adoc", ".asciidoc", ".csv", ".htm", ".html", ".markdown", ".md", ".mdx", ".org", ".rst", ".svg", ".tex", ".tsv", ".txt", ".xml",
]);
const DOCUMENT_EXTENSIONS = new Set([".docx", ".pptx", ".pdf"]);
const READER_FACING_NAMES = new Set(["CHANGELOG", "CONTRIBUTING", "LICENSE", "NOTICE", "README"]);
const INTERNAL_PATH_COMPONENTS = new Set(["plans", "evidence", "ledger", "ledgers", ".hermes", [".", "om", "o"].join("")]);
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const cleanResult = { status: "clean", findings: [], paths: [] };
const extensionOf = (path) => extname(path).toLowerCase();
const readerFacing = (path) => TEXT_EXTENSIONS.has(extensionOf(path))
  || DOCUMENT_EXTENSIONS.has(extensionOf(path))
  || READER_FACING_NAMES.has(path.split(/[\\/]/u).at(-1).toUpperCase());

const internalPath = (cwd, path) => {
  const components = relative(resolve(cwd), path).split(/[\\/]/u).filter(Boolean);
  const basename = components.at(-1) ?? "";
  return components.some((component) => {
    const lower = component.toLowerCase();
    return INTERNAL_PATH_COMPONENTS.has(lower) || lower.startsWith(".lit");
  }) || /^handoff/iu.test(basename)
    || /(?:^|[._-])ledger(?:[._-]|$)/iu.test(basename)
    || /\.jsonl$/iu.test(basename);
};

const pathWithin = (cwd, path) => {
  if (typeof cwd !== "string" || typeof path !== "string" || cwd.length === 0 || path.length === 0) return null;
  const root = resolve(cwd);
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const rel = relative(root, absolutePath);
  return isAbsolute(rel) || rel.split(/[\\/]/u)[0] === ".." ? null : absolutePath;
};

const toolArtifacts = (input) => {
  const toolName = typeof input?.tool_name === "string" ? input.tool_name.toLowerCase() : "";
  const toolInput = isRecord(input?.tool_input) ? input.tool_input : null;
  if (!toolInput) return { artifacts: [], skipped: false };
  const path = [toolInput.file_path, toolInput.filePath, toolInput.path].find((value) => typeof value === "string" && value.length > 0);
  if (toolName === "write") {
    if (!path || typeof toolInput.content !== "string") return { artifacts: [], skipped: true };
    return { artifacts: [{ path, text: toolInput.content, readBefore: true }], skipped: false };
  }
  if (toolName === "edit") {
    const text = typeof toolInput.new_string === "string" ? toolInput.new_string : toolInput.newString;
    const before = typeof toolInput.old_string === "string" ? toolInput.old_string : toolInput.oldString;
    if (!path || typeof text !== "string") return { artifacts: [], skipped: true };
    return { artifacts: [{ path, text, ...(typeof before === "string" ? { before } : {}) }], skipped: false };
  }
  if (toolName !== "multiedit" && toolName !== "multi_edit") return { artifacts: [], skipped: false };
  if (path && Array.isArray(toolInput.edits)) {
    const artifacts = [];
    for (const edit of toolInput.edits) {
      if (!isRecord(edit)) return { artifacts: [], skipped: true };
      const text = typeof edit.new_string === "string" ? edit.new_string : edit.newString;
      const before = typeof edit.old_string === "string" ? edit.old_string : edit.oldString;
      if (typeof text !== "string") return { artifacts: [], skipped: true };
      artifacts.push({ path, text, ...(typeof before === "string" ? { before } : {}) });
    }
    return { artifacts, skipped: false };
  }
  if (!Array.isArray(toolInput.files)) return { artifacts: [], skipped: true };
  const artifacts = [];
  for (const file of toolInput.files) {
    if (!isRecord(file)) return { artifacts: [], skipped: true };
    const filePath = [file.file_path, file.filePath, file.path].find((value) => typeof value === "string" && value.length > 0);
    const text = [file.content, file.new_string, file.newString].find((value) => typeof value === "string");
    const before = [file.old_string, file.oldString].find((value) => typeof value === "string");
    if (!filePath || text === undefined) return { artifacts: [], skipped: true };
    artifacts.push({ path: filePath, text, ...(typeof before === "string" ? { before } : {}) });
  }
  return { artifacts, skipped: false };
};

const changedLines = (before, after) => {
  if (before === after) return "";
  const oldLines = before.split(/\r?\n/u);
  const newLines = after.split(/\r?\n/u);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) return null;
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix += 1;
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  if (oldMiddle.length === 0) return newMiddle.join("\n");
  if (newMiddle.length === 0) return "";

  const n = oldMiddle.length;
  const m = newMiddle.length;
  let frontier = new Map([[1, 0]]);
  const trace = [];
  let traceCells = 0;
  let work = 0;
  for (let distance = 0; distance <= n + m; distance += 1) {
    trace.push(new Map(frontier));
    traceCells += frontier.size;
    if (traceCells > MAX_DIFF_TRACE_CELLS) return null;
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const x = diagonal === -distance
        || (diagonal !== distance && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0
        : (frontier.get(diagonal - 1) ?? 0) + 1;
      let nextX = x;
      let nextY = nextX - diagonal;
      while (nextX < n && nextY < m && nextX >= 0 && nextY >= 0
        && oldMiddle[nextX] === newMiddle[nextY]) {
        nextX += 1;
        nextY += 1;
        work += 1;
      }
      frontier.set(diagonal, nextX);
      work += 1;
      if (work > MAX_DIFF_WORK) return null;
      if (nextX < n || nextY < m) continue;

      const added = [];
      let backX = n;
      let backY = m;
      for (let backDistance = distance; backDistance >= 0; backDistance -= 1) {
        const previous = trace[backDistance];
        const backDiagonal = backX - backY;
        const previousDiagonal = backDiagonal === -backDistance
          || (backDiagonal !== backDistance
            && (previous.get(backDiagonal - 1) ?? -Infinity) < (previous.get(backDiagonal + 1) ?? -Infinity))
          ? backDiagonal + 1
          : backDiagonal - 1;
        const previousX = previous.get(previousDiagonal) ?? 0;
        const previousY = previousX - previousDiagonal;
        while (backX > previousX && backY > previousY) {
          backX -= 1;
          backY -= 1;
        }
        if (backDistance === 0) break;
        if (backX === previousX) {
          added.push(newMiddle[backY - 1]);
          backY -= 1;
        } else {
          backX -= 1;
        }
      }
      return added.reverse().join("\n");
    }
  }
  return null;
};

const runScanner = (artifacts, pluginRoot, execute = spawnSync) => {
  const script = resolve(pluginRoot, "skills/lit-humanizer/scripts/scan-input.mjs");
  const request = JSON.stringify({ artifacts });
  let run;
  try {
    run = execute(process.execPath, [script], {
      input: request,
      encoding: "utf8",
      timeout: SCANNER_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
  } catch {
    return { failure: "could not complete" };
  }
  if (run.error?.code === "ETIMEDOUT") return { failure: "timed out" };
  if (run.error || run.status !== 0) return { failure: "could not complete" };
  try {
    const parsed = JSON.parse(run.stdout);
    if (!Array.isArray(parsed.findings)) return { failure: "returned an invalid result" };
    return { findings: parsed.findings };
  } catch {
    return { failure: "returned an invalid result" };
  }
};

const resultFor = (findings, paths) => ({
  status: findings.some((finding) => finding.severity === "block")
    ? "block"
    : findings.some((finding) => finding.severity === "warn") ? "warn" : "clean",
  findings,
  paths,
});

export const scanHumanizerText = async (text, file = "<stdin>", pluginRoot) => {
  const scanned = runScanner([{ path: file, text }], pluginRoot);
  if (scanned.failure) throw new Error(`lit-humanizer scan ${scanned.failure}`);
  return scanned.findings;
};

const evaluateDeliverableHedgeGuardInternal = ({ input, pluginRoot, phase = "pre-write", execute = spawnSync }) => {
  if (!isRecord(input) || typeof pluginRoot !== "string") return cleanResult;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();

  if (phase === "post-create") {
    const failed = isRecord(input.tool_response)
      && (input.tool_response.isError === true || input.tool_response.is_error === true
        || input.tool_response.error === true || input.tool_response.status === "error");
    if (failed) return cleanResult;
    const paths = [...new Set([...extractMutatedFilePaths(input), ...extractCreatedDocumentPaths(input)])]
      .map((path) => pathWithin(cwd, path))
      .filter((path) => path !== null && !internalPath(cwd, path) && DOCUMENT_EXTENSIONS.has(extensionOf(path)));
    if (paths.length === 0) return cleanResult;
    if (paths.length > 2) return { status: "unavailable", reason: "document count exceeded the check limit", findings: [], paths: [] };
    const artifacts = [];
    let aggregateBytes = 0;
    for (const path of paths) {
      const read = readRegularStable(cwd, path, undefined, { maxBytes: MAX_POST_CREATE_BYTES });
      if (read.failure) return { status: "unavailable", reason: "document could not be read safely", findings: [], paths: [] };
      aggregateBytes += read.bytes.length;
      if (aggregateBytes > MAX_POST_CREATE_BYTES) return { status: "unavailable", reason: "document size exceeded the check limit", findings: [], paths: [] };
      try {
        artifacts.push({ path, text: extractArtifactText(extensionOf(path), read.bytes) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "document extraction failed";
        return { status: "unavailable", reason, findings: [], paths: [] };
      }
    }
    const scanned = runScanner(artifacts, pluginRoot, execute);
    if (scanned.failure) return { status: "unavailable", reason: `detector ${scanned.failure}`, findings: [], paths: [] };
    return { ...resultFor(scanned.findings, paths), phase };
  }

  const { artifacts: candidates, skipped } = toolArtifacts(input);
  if (candidates.length === 0) return skipped
    ? { status: "unavailable", reason: "changed text could not be read from the tool input", findings: [], paths: [] }
    : cleanResult;
  if (candidates.length > MAX_ARTIFACT_PATHS) return { status: "unavailable", reason: "file count exceeded the check limit", findings: [], paths: [] };
  const byPath = new Map();
  let aggregateBytes = 0;
  for (const candidate of candidates) {
    const path = pathWithin(cwd, candidate.path);
    if (path === null || internalPath(cwd, path) || !readerFacing(path) || DOCUMENT_EXTENSIONS.has(extensionOf(path))) continue;
    let text = candidate.text;
    if (typeof candidate.before === "string") {
      text = changedLines(candidate.before, text);
      if (text === null) return { status: "unavailable", reason: "changed-text diff exceeded the check limit", findings: [], paths: [] };
    } else if (candidate.readBefore) {
      let exists;
      try { exists = lstatSync(path, { throwIfNoEntry: false }); } catch {
        return { status: "unavailable", reason: "existing text could not be checked safely", findings: [], paths: [] };
      }
      if (exists) {
        const read = readRegularStable(cwd, path, undefined, { maxBytes: MAX_ARTIFACT_BYTES });
        if (read.failure) return { status: "unavailable", reason: "existing text could not be read safely", findings: [], paths: [] };
        text = changedLines(read.bytes.toString("utf8"), text);
        if (text === null) return { status: "unavailable", reason: "changed-text diff exceeded the check limit", findings: [], paths: [] };
      }
    }
    if (!text) continue;
    const bytes = Buffer.byteLength(text, "utf8");
    aggregateBytes += bytes;
    if (bytes > MAX_ARTIFACT_BYTES || aggregateBytes > MAX_AGGREGATE_BYTES) {
      return { status: "unavailable", reason: "changed text exceeded the check limit", findings: [], paths: [] };
    }
    byPath.set(path, byPath.has(path) ? `${byPath.get(path)}\n${text}` : text);
  }
  if (byPath.size === 0) return cleanResult;
  const artifacts = [...byPath].map(([path, text]) => ({ path, text }));
  const scanned = runScanner(artifacts, pluginRoot, execute);
  if (scanned.failure) return { status: "unavailable", reason: `detector ${scanned.failure}`, findings: [], paths: [] };
  return resultFor(scanned.findings, artifacts.map(({ path }) => path));
};

export const evaluateDeliverableHedgeGuard = (options) => {
  try {
    return evaluateDeliverableHedgeGuardInternal(options);
  } catch {
    return { status: "unavailable", reason: "check could not complete", findings: [], paths: [] };
  }
};

const findingSummary = (result) => {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const listed = findings.slice(0, 8).map((finding) => `${finding.rule} line ${finding.line}`).join(", ");
  const omitted = findings.length > 8 ? `; ${findings.length - 8} more` : "";
  return listed ? `${listed}${omitted}` : "pattern review needed";
};

export const formatDeliverableHedgeContext = (result) => {
  if (result?.status === "unavailable") return `lit-humanizer check skipped; the write was allowed (${String(result.reason ?? "guard unavailable").slice(0, 120)}).`;
  if (result?.status === "warn") return `lit-humanizer warning: review the changed prose in context; warnings do not block a write (${findingSummary(result)}).`;
  if (result?.phase === "post-create" && result?.status === "block") return `lit-humanizer post-create block finding: the document was created; revise the flagged drafting label or disclaimer (${findingSummary(result)}).`;
  return "";
};

export const formatHumanizerBlockReason = (result) =>
  `lit-humanizer blocked this write because changed prose matches a high-confidence drafting-residue rule (${findingSummary(result)}). Rewrite the new text or use the requested citation format.`;
