import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const runMcp = (messages, env = {}) =>
  new Promise((resolve, reject) => {
    const serverPath = join(pluginRoot, "bin", "litclaude-mcp.js");
    const child = spawn(process.execPath, [serverPath], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MCP timed out. stdout=${stdout} stderr=${stderr}`));
    }, 2000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status !== 0) {
        reject(new Error(`MCP exited ${status}. stderr=${stderr}`));
        return;
      }
      resolve(stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
    });

    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });

describe("MCP and LSP config", () => {
  it("declares plugin-local MCP helpers", () => {
    const path = join(pluginRoot, ".mcp.json");
    assert.equal(existsSync(path), true, ".mcp.json must exist");

    const config = readJson(path);
    assert.equal(config.mcpServers.litclaude.type, "stdio");
    assert.deepEqual(config.mcpServers.litclaude.args, ["${CLAUDE_PLUGIN_ROOT}/bin/litclaude-mcp.js"]);
  });

  it("responds to the MCP initialize handshake", () => {
    const serverPath = join(pluginRoot, "bin", "litclaude-mcp.js");
    const result = spawnSync(
      process.execPath,
      [serverPath],
      {
        cwd: root,
        encoding: "utf8",
        input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
        timeout: 1000,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines[0].id, 1);
    assert.equal(lines[0].result.serverInfo.name, "litclaude");
    assert.equal(lines[0].result.serverInfo.version, readJson(join(root, "package.json")).version);
    assert.equal(lines[1].result.tools.some((tool) => tool.name === "public_source_read"), true);
  });

  it("exposes public_source_read with controlled safety failures", async () => {
    const lines = await runMcp([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "public_source_read", arguments: { input: "http://127.0.0.1/private" } },
      },
    ]);

    const [list, call] = lines;
    const tool = list.result.tools.find((entry) => entry.name === "public_source_read");
    assert.equal(tool.inputSchema.required.includes("input"), true);
    assert.equal(call.id, 2);
    assert.equal(call.result.isError, true);
    assert.equal(call.result.content[0].type, "text");
    const report = JSON.parse(call.result.content[0].text);
    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.equal(report.stopReason, "private-address");
    assert.deepEqual(report.contentSafety, { untrusted: true, instructionsIgnored: true });
  });

  it("keeps MCP private targets blocked when the legacy environment sentinel is set", async () => {
    const lines = await runMcp([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "public_source_read", arguments: { input: "http://127.0.0.1/private" } },
      },
    ], { LITCLAUDE_PUBLIC_READ_ALLOW_PRIVATE: "1" });

    const report = JSON.parse(lines[0].result.content[0].text);
    assert.equal(lines[0].result.isError, true);
    assert.equal(report.status, "blocked");
    assert.equal(report.stopReason, "private-address");
  });

  it("declares TypeScript and JavaScript LSP support", () => {
    const path = join(pluginRoot, ".lsp.json");
    assert.equal(existsSync(path), true, ".lsp.json must exist");

    const config = readJson(path);
    assert.deepEqual(config.typescript.command, ["typescript-language-server", "--stdio"]);
    assert.equal(config.typescript.extensionToLanguage[".ts"], "typescript");
    assert.equal(config.typescript.extensionToLanguage[".js"], "javascript");
  });

  it("reports missing TypeScript language server as actionable guidance", () => {
    const doctorPath = join(pluginRoot, "bin", "litclaude-lsp-doctor.js");
    assert.equal(existsSync(doctorPath), true, "LSP doctor must exist");

    const result = spawnSync(process.execPath, [doctorPath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin" },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /typescript-language-server/u);
    assert.match(result.stdout, /npm install -g typescript-language-server typescript/u);
  });
});
