import assert from "node:assert/strict";
import test from "node:test";
import { extractMutatedFilePaths, serializeUntrustedData } from "../plugins/litclaude/lib/mutated-file-paths.mjs";

test("extracts write and edit file paths", () => {
  assert.deepEqual(
    extractMutatedFilePaths({ tool_name: "Write", tool_input: { file_path: "README.md" } }),
    ["README.md"],
  );
  assert.deepEqual(
    extractMutatedFilePaths({ tool_name: "Edit", tool_input: { filePath: "src/app.js" } }),
    ["src/app.js"],
  );
});

test("extracts patch-shaped inputs and keeps paths unique", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: test/new.test.mjs",
    "+ok",
    "*** Update File: plugins/litclaude/bin/litclaude-hook.js",
    " old",
    "*** Move to: plugins/litclaude/bin/renamed-hook.js",
    "*** End Patch",
  ].join("\n");

  assert.deepEqual(
    extractMutatedFilePaths({ tool_name: "apply_patch", tool_input: { input: patch } }),
    [
      "test/new.test.mjs",
      "plugins/litclaude/bin/litclaude-hook.js",
      "plugins/litclaude/bin/renamed-hook.js",
    ],
  );
});

test("ignores failed tool responses and non-mutating tools", () => {
  assert.deepEqual(
    extractMutatedFilePaths({
      tool_name: "Write",
      tool_input: { file_path: "README.md" },
      tool_response: { isError: true },
    }),
    [],
  );
  assert.deepEqual(
    extractMutatedFilePaths({ tool_name: "Read", tool_input: { file_path: "README.md" } }),
    [],
  );
});

test("serializes Unicode format controls as visible inert escapes", () => {
  const controls = "\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\ufeff";
  const serialized = serializeUntrustedData(`safe${controls}text`);

  assert.doesNotMatch(serialized, /\p{Cf}/u);
  for (const codePoint of ["200b", "200c", "200d", "200e", "200f", "202a", "202b", "202c", "202d", "202e", "2066", "2067", "2068", "2069", "feff"]) {
    assert.match(serialized, new RegExp(`\\\\u${codePoint}`, "u"));
  }
});
