import { parsePlanTaskRows, planLinesOutsideFences } from "./plan-task-rows.mjs";

const IMPLEMENTATION_ROW_PATTERN = /^- \[[ xX]\] (\d+)\. /u;

// A plan that hands rows to anyone but the main session says, before work starts, what each row
// waits for, who runs it, where, and how its result comes back. This module checks that a plan
// which delegates carries those parts; a plan with one lane writes one line instead.

export const SINGLE_LANE_LINE = "Orchestration: single lane";
export const MATRIX_COLUMNS = ["Row", "Needs first", "Same lane as", "Runs with", "Who must act besides Claude"];
export const EXECUTOR_COLUMNS = ["Row", "Executor", "Why", "Fallback"];
export const COURIER_COLUMNS = ["Row", "Question", "Where to ask", "Answer file", "Meanwhile", "If no answer"];
export const ORCHESTRATION_PARTS = ["Executors", "Isolation", "Concurrency", "Hand-back", "Watchdog", "Courier rows", "Guard notes"];

// The executors a Claude Code plan may name. Each entry: what the cell must look like, whether it is
// a delegate (needs a fallback), and what else its row has to say.
const EXECUTORS = [
  { name: "main session", pattern: /^(?:the )?main session\b/iu, delegate: false },
  { name: "subagent", pattern: /\bsubagent\b|^litclaude:[a-z-]+\b/iu, delegate: true },
  { name: "Workflow", pattern: /^workflow\b/iu, delegate: true, needs: [/opt-in/iu, "says it needs the user's own opt-in word"] },
  { name: "lit-team", pattern: /^lit[- ]team\b/iu, delegate: true },
  { name: "herdr pane", pattern: /^herdr pane\b/iu, delegate: true, needs: [/HERDR_ENV|herdr is on/iu, "says it applies only when herdr is on (HERDR_ENV=1)"] },
  { name: "the user", pattern: /^(?:the )?(?:user|maintainer)\b/iu, delegate: false },
];
const EXECUTOR_WORD = /\b(?:subagent|workflow|lit[- ]team|herdr|teammate)\b/iu;
const EMPTY_CELL = /^(?:|-|—|none|n\/a|no)$/iu;

const cells = (line) => line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
const isTableLine = (line) => /^\s*\|.*\|\s*$/u.test(line);
const isRule = (line) => /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/u.test(line);

// The lines under a heading, up to the next heading of the same or a higher level.
const sectionLines = (visible, title, from = 0) => {
  const start = visible.findIndex(({ line }, index) => index >= from && new RegExp(`^#{2,3} ${title}\\s*$`, "iu").test(line));
  if (start === -1) return null;
  const depth = /^#+/u.exec(visible[start].line)[0].length;
  const body = [];
  for (const { line } of visible.slice(start + 1)) {
    const heading = /^(#+) /u.exec(line);
    if (heading && heading[1].length <= depth) break;
    body.push(line);
  }
  return body;
};

// The first table in a block as { header, rows }, each row an object keyed by the header cells.
const firstTable = (block) => {
  const at = block.findIndex(isTableLine);
  if (at === -1) return null;
  const header = cells(block[at]);
  const rows = [];
  for (const line of block.slice(at + 1)) {
    if (!isTableLine(line)) break;
    if (isRule(line)) continue;
    const values = cells(line);
    rows.push(Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
  }
  return { header, rows };
};

const missingColumns = (table, columns) => columns.filter((column) => !table.header.includes(column));
// "1", "F1", "2, 3", "rows 4 to 6" and "F1–F4" all name rows. A range wider than a plan can be is ignored.
const MAX_ROW_SPAN = 200;
const rowIds = (cell) => {
  const ids = new Set();
  for (const raw of cell.split(/,|\band\b/u)) {
    const part = raw.trim().replace(/^rows?\s+/iu, "");
    const range = /^(F?)(\d+)\s*(?:to|-|–)\s*F?(\d+)$/iu.exec(part);
    if (range) {
      const [first, last] = [Number(range[2]), Number(range[3])];
      if (last - first <= MAX_ROW_SPAN) for (let n = first; n <= last; n += 1) ids.add(`${range[1].toUpperCase()}${n}`);
    } else if (/^F?\d+$/iu.test(part)) ids.add(part.toUpperCase());
  }
  return [...ids];
};

// Whether the plan shows that someone besides the main session runs a row: it has the section, or a
// row's Parallelization line names a delegate. A wave label orders the work and is no such sign: the
// main session may run every row of a wave itself, one after another.
export const planDelegates = (text) => {
  const visible = planLinesOutsideFences(text).map(({ line }) => line);
  if (visible.some((line) => /^## Orchestration\s*$/u.test(line))) return true;
  return visible.filter((line) => /^\s+Parallelization:/u.test(line)).some((line) => EXECUTOR_WORD.test(line));
};

export function checkPlanOrchestration(text) {
  const problems = [];
  const visibleEntries = planLinesOutsideFences(text);
  const visible = visibleEntries.map(({ line }) => line);
  const singleLane = visible.some((line) => line.trim() === SINGLE_LANE_LINE);
  const hasSection = visible.some((line) => /^## Orchestration\s*$/u.test(line));
  const delegates = planDelegates(text);

  if (singleLane) {
    if (hasSection) problems.push(`orchestration: the plan says "${SINGLE_LANE_LINE}" and also has a ## Orchestration section; keep one`);
    else if (delegates) problems.push(`orchestration: the plan says "${SINGLE_LANE_LINE}" but a row's Parallelization line names a delegate; write the ## Orchestration section instead`);
    return { ok: problems.length === 0, problems, delegates };
  }
  if (!delegates) return { ok: true, problems, delegates };

  const planRows = parsePlanTaskRows(text).map(({ line }) => IMPLEMENTATION_ROW_PATTERN.exec(line)?.[1]).filter(Boolean);

  // The scaffold leaves an empty matrix under "Execution strategy"; a plan may fill that one or
  // write its own section further down, so the first matrix that has lines is the plan's.
  const matrix = visible
    .flatMap((line, index) => (/^#{2,3} Dependency matrix\s*$/iu.test(line) ? [firstTable(sectionLines(visibleEntries, "Dependency matrix", index))] : []))
    .find((table) => table && table.rows.length > 0);
  if (!matrix || matrix.rows.length === 0) {
    problems.push(`orchestration: missing "Dependency matrix" table with the columns ${MATRIX_COLUMNS.join(" | ")}`);
  } else {
    const missing = missingColumns(matrix, MATRIX_COLUMNS);
    if (missing.length > 0) problems.push(`orchestration: the dependency matrix lacks the column(s) ${missing.join(", ")}`);
    else {
      const lanes = new Map();
      for (const row of matrix.rows) for (const id of rowIds(row.Row)) lanes.set(id, row);
      const absent = planRows.filter((id) => !lanes.has(id));
      if (absent.length > 0) problems.push(`orchestration: the dependency matrix has no line for row(s) ${absent.join(", ")}`);
      for (const [id, row] of lanes) {
        if (EMPTY_CELL.test(row["Same lane as"])) continue;
        for (const other of rowIds(row["Runs with"])) {
          const peer = lanes.get(other);
          if (peer && other !== id && peer["Same lane as"].toLowerCase() === row["Same lane as"].toLowerCase()) {
            problems.push(`orchestration: rows ${id} and ${other} are set to run together but share "${row["Same lane as"]}"; one writer per checkout and one run per real host`);
          }
        }
      }
    }
  }

  if (!hasSection) {
    problems.push(`orchestration: missing section: ## Orchestration (parts: ${ORCHESTRATION_PARTS.join(", ")}), or the single line "${SINGLE_LANE_LINE}" for a plan nobody else works on`);
    return { ok: false, problems, delegates };
  }
  const section = sectionLines(visibleEntries, "Orchestration", visible.findIndex((line) => /^## Orchestration\s*$/u.test(line)));
  const sectionEntries = section.map((line) => ({ line }));
  const part = (title) => sectionLines(sectionEntries, title);
  for (const title of ORCHESTRATION_PARTS) {
    const body = part(title);
    if (!body) problems.push(`orchestration: missing part: ### ${title}`);
    else if (!body.some((line) => line.trim() !== "")) problems.push(`orchestration: part "### ${title}" is empty`);
  }

  const executors = part("Executors") && firstTable(part("Executors"));
  if (part("Executors") && (!executors || executors.rows.length === 0)) {
    problems.push(`orchestration: "### Executors" needs a table with the columns ${EXECUTOR_COLUMNS.join(" | ")}`);
  } else if (executors) {
    const missing = missingColumns(executors, EXECUTOR_COLUMNS);
    if (missing.length > 0) problems.push(`orchestration: the executors table lacks the column(s) ${missing.join(", ")}`);
    else {
      const named = new Set(executors.rows.flatMap((row) => rowIds(row.Row)));
      const absent = planRows.filter((id) => !named.has(id));
      if (absent.length > 0) problems.push(`orchestration: no executor is named for row(s) ${absent.join(", ")}`);
      for (const row of executors.rows) {
        const kind = EXECUTORS.find(({ pattern }) => pattern.test(row.Executor));
        if (!kind) {
          problems.push(`orchestration: row ${row.Row} names the executor "${row.Executor}", which Claude Code does not have; use one of: ${EXECUTORS.map(({ name }) => name).join(", ")}`);
          continue;
        }
        if (EMPTY_CELL.test(row.Why)) problems.push(`orchestration: row ${row.Row} gives no reason for its executor`);
        if (kind.delegate && EMPTY_CELL.test(row.Fallback)) problems.push(`orchestration: row ${row.Row} is delegated to ${kind.name} with no fallback executor`);
        else if (kind.delegate && !EXECUTORS.some(({ pattern }) => pattern.test(row.Fallback))) {
          problems.push(`orchestration: row ${row.Row} falls back to "${row.Fallback}", which names no executor Claude Code has; start it with one of: ${EXECUTORS.map(({ name }) => name).join(", ")}`);
        }
        if (kind.needs && !kind.needs[0].test(`${row.Executor} ${row.Why}`)) problems.push(`orchestration: row ${row.Row} uses ${kind.name}; its line ${kind.needs[1]}`);
      }
    }
  }

  const courier = part("Courier rows");
  const courierTable = courier && firstTable(courier);
  if (courier && courier.some((line) => line.trim() !== "") && (courierTable || !/^\s*none\b/iu.test(courier.find((line) => line.trim() !== "")))) {
    const table = courierTable;
    if (!table || table.rows.length === 0) problems.push(`orchestration: "### Courier rows" is "none" or a table with the columns ${COURIER_COLUMNS.join(" | ")}`);
    else {
      const missing = missingColumns(table, COURIER_COLUMNS);
      if (missing.length > 0) problems.push(`orchestration: the courier table lacks the column(s) ${missing.join(", ")}`);
      else {
        for (const row of table.rows) {
          const empty = COURIER_COLUMNS.filter((column) => (column === "Meanwhile" ? row[column].trim() === "" : EMPTY_CELL.test(row[column])));
          if (empty.length > 0) problems.push(`orchestration: courier row ${row.Row || "?"} lacks ${empty.join(", ")}`);
        }
      }
    }
  }

  return { ok: problems.length === 0, problems, delegates };
}
