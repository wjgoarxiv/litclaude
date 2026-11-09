const mutationToolNames = new Set(["apply_patch", "write", "edit", "multiedit", "multi_edit", "notebookedit"]);

const visibleUtf16Escapes = (value) => {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    escaped += `\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  return escaped;
};

export const serializeUntrustedData = (value) =>
  JSON.stringify(value)
    .replace(/[\u007f-\u009f]|\p{Cf}/gu, visibleUtf16Escapes)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("`", "\\u0060")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const addString = (paths, value) => {
  if (typeof value === "string" && value.length > 0) paths.add(value);
};

const addStringArray = (paths, value) => {
  if (!Array.isArray(value)) return;
  for (const item of value) addString(paths, item);
};

const patchHeaderPath = (line) => {
  for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Move to: "]) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return undefined;
};

const addPatchInput = (paths, value) => {
  if (typeof value !== "string") return;
  for (const line of value.split(/\r?\n/u)) {
    const path = patchHeaderPath(line);
    if (path) paths.add(path);
  }
};

const addPatchRecords = (paths, value) => {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    addString(paths, item.path);
    addString(paths, item.filePath);
    addString(paths, item.file_path);
    addString(paths, item.movePath);
    addString(paths, item.move_path);
  }
};

const isFailedResponse = (value) =>
  isRecord(value) && (value.isError === true || value.is_error === true || value.error === true
    || value.interrupted === true || value.status === "error"
    || (typeof value.exitCode === "number" && value.exitCode !== 0)
    || (typeof value.exit_code === "number" && value.exit_code !== 0));

const documentExtension = /\.(?:docx|pptx|pdf)$/iu;
const outputPathTokens = (value) => {
  if (typeof value !== "string") return [];
  const paths = [];
  for (const match of value.matchAll(/"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'\x60<>]+)/gu)) {
    const candidate = (match[1] ?? match[2] ?? match[3] ?? "").replace(/[.,;:!?)}\]]+$/u, "");
    if (documentExtension.test(candidate)) paths.push(candidate);
  }
  return paths;
};

export const extractCreatedDocumentPaths = (input) => {
  if (typeof input?.tool_name !== "string" || input.tool_name.toLowerCase() !== "bash"
    || isFailedResponse(input.tool_response) || !isRecord(input.tool_response)) return [];
  const response = input.tool_response;
  const paths = new Set();
  for (const key of ["filePath", "file_path", "path", "outputPath", "output_path"]) {
    if (typeof response[key] === "string" && documentExtension.test(response[key])) paths.add(response[key]);
  }
  for (const key of ["filePaths", "file_paths", "paths", "outputFiles", "output_files"]) {
    if (Array.isArray(response[key])) {
      for (const path of response[key]) if (typeof path === "string" && documentExtension.test(path)) paths.add(path);
    }
  }
  for (const key of ["stdout", "stderr"]) for (const path of outputPathTokens(response[key])) paths.add(path);
  return [...paths];
};

export const extractMutatedFilePaths = (input) => {
  const toolName = typeof input?.tool_name === "string" ? input.tool_name.toLowerCase() : "";
  if (!mutationToolNames.has(toolName)) return [];
  if (isFailedResponse(input.tool_response)) return [];

  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const paths = new Set();
  addString(paths, toolInput.path);
  addString(paths, toolInput.filePath);
  addString(paths, toolInput.file_path);
  addStringArray(paths, toolInput.paths);
  addStringArray(paths, toolInput.filePaths);
  addStringArray(paths, toolInput.file_paths);
  addPatchInput(paths, toolInput.input);
  addPatchInput(paths, toolInput.patch);
  addPatchInput(paths, toolInput.command);
  addPatchRecords(paths, toolInput.files);
  addPatchRecords(paths, toolInput.changes);
  return [...paths];
};
