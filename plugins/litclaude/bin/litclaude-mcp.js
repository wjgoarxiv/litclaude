#!/usr/bin/env node

import { readPublicSource } from "../lib/public-source-reader/reader.mjs";
import {
  captureKnowledgeEvent,
  queryKnowledge,
  reviewKnowledgeRecord,
  WikifyKnowledgeError,
} from "../lib/wikify-knowledge.mjs";

const protocolVersion = "2024-11-05";
const serverVersion = "1.0.19";

const publicSourceReadTool = {
  name: "public_source_read",
  description: "Read a public http(s) source with SSRF, auth, paywall, FetchAttempt, FetchVerdict, and inert untrusted-content safety evidence.",
  inputSchema: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Public http(s) URL or query text. URL input is read directly; private/local targets are blocked by default.",
      },
    },
    required: ["input"],
    additionalProperties: false,
  },
};

const wikifyCaptureTool = {
  name: "wikify_capture",
  description: "Capture one bounded structured project claim. New claims require explicit review before query use.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["fact", "decision", "failure", "risk", "rule", "checkpoint"] },
      text: { type: "string", maxLength: 512 },
      provenanceRef: { type: "string", maxLength: 256 },
      evidenceRef: { type: "string", maxLength: 256 },
    },
    required: ["kind", "text", "provenanceRef", "evidenceRef"],
    additionalProperties: false,
  },
};

const wikifyCaptureInputKeys = new Set(["kind", "text", "provenanceRef", "evidenceRef"]);
const wikifyReviewInputKeys = new Set(["id", "state"]);
const wikifyQueryInputKeys = new Set(["text", "budget"]);
const assertWikifyInputKeys = (args, allowedKeys, label) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new WikifyKnowledgeError(`${label} arguments must be an object`);
  }
  if (Object.keys(args).some((key) => !allowedKeys.has(key))) {
    throw new WikifyKnowledgeError(`${label} arguments contain an unknown input key`);
  }
};
const assertWikifyCaptureInputKeys = (args) => assertWikifyInputKeys(args, wikifyCaptureInputKeys, "wikify_capture");
const assertWikifyReviewInputKeys = (args) => assertWikifyInputKeys(args, wikifyReviewInputKeys, "wikify_review");
const assertWikifyQueryInputKeys = (args) => assertWikifyInputKeys(args, wikifyQueryInputKeys, "wikify_query");

const wikifyReviewTool = {
  name: "wikify_review",
  description: "Explicitly set a local Wikify claim to accepted, rejected, or stale.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^wk-[a-f0-9]{24}$" },
      state: { type: "string", enum: ["accepted", "rejected", "stale"] },
    },
    required: ["id", "state"],
    additionalProperties: false,
  },
};

const wikifyQueryTool = {
  name: "wikify_query",
  description: "Return a bounded deterministic block of accepted relevant local claims. No match returns no block.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 512 },
      budget: { type: "integer", minimum: 256, maximum: 4096, default: 2048 },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

const tools = [publicSourceReadTool, wikifyCaptureTool, wikifyReviewTool, wikifyQueryTool];

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const result = (id, value) => write({ jsonrpc: "2.0", id, result: value });

const error = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

const handleMessage = async (message) => {
  if (!message || typeof message !== "object" || !("id" in message)) {
    return;
  }

  switch (message.method) {
    case "initialize":
      result(message.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "litclaude", version: serverVersion },
      });
      break;
    case "ping":
      result(message.id, {});
      break;
    case "tools/list":
      result(message.id, { tools });
      break;
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments;
      if (name === "public_source_read") {
        if (typeof args?.input !== "string") {
          error(message.id, -32602, "public_source_read requires string argument: input");
          break;
        }
        const report = await readPublicSource(message.params.arguments.input);
        result(message.id, {
          isError: !report.ok,
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        });
        break;
      }

      try {
        if (name === "wikify_capture") {
          assertWikifyCaptureInputKeys(args);
          const report = captureKnowledgeEvent(process.cwd(), {
            kind: args?.kind,
            text: args?.text,
            provenance: { ref: args?.provenanceRef },
            evidence: { ref: args?.evidenceRef },
          }, { surface: "mcp" });
          result(message.id, {
            isError: false,
            content: [{ type: "text", text: JSON.stringify(report) }],
          });
          break;
        }
        if (name === "wikify_review") {
          assertWikifyReviewInputKeys(args);
          const report = reviewKnowledgeRecord(process.cwd(), args?.id, args?.state, { surface: "mcp-review" });
          result(message.id, {
            isError: false,
            content: [{ type: "text", text: JSON.stringify(report) }],
          });
          break;
        }
        if (name === "wikify_query") {
          assertWikifyQueryInputKeys(args);
          const block = queryKnowledge(process.cwd(), args?.text, { budget: args?.budget });
          result(message.id, { isError: false, content: block ? [{ type: "text", text: block }] : [] });
          break;
        }
      } catch (knowledgeError) {
        if (knowledgeError instanceof WikifyKnowledgeError) {
          result(message.id, {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: knowledgeError.message }) }],
          });
          break;
        }
        result(message.id, {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: "wikify knowledge runtime error" }) }],
        });
        break;
      }
      error(message.id, -32601, `Unknown tool: ${name ?? ""}`);
      break;
    }
    default:
      error(message.id, -32601, `Unknown method: ${message.method}`);
      break;
  }
};

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) {
      try {
        void handleMessage(JSON.parse(line));
      } catch {
        error(null, -32700, "Parse error");
      }
    }
    newlineIndex = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  const line = buffer.trim();
  if (line) {
    try {
      void handleMessage(JSON.parse(line));
    } catch {
      error(null, -32700, "Parse error");
    }
  }
});
