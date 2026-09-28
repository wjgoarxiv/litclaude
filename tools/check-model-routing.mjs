#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_ROOT = join(ROOT, 'plugins', 'litclaude', 'agents');
const ROUTE_FIELDS = new Set(['route', 'model', 'effort', 'reasoning_effort']);
const MODEL_IDS = new Set(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
const EFFORTS = new Set(['max', 'xhigh']);

export const APPROVED_MODEL_ROUTES = Object.freeze({
  lead: Object.freeze({ model: 'gpt-6-astra', effort: 'xhigh' }),
  'ordinary-worker': Object.freeze({ model: 'gpt-6-luna', effort: 'max' }),
  momus: Object.freeze({ model: 'gpt-6-astra', effort: 'xhigh' }),
  'litwork-reviewer': Object.freeze({ model: 'gpt-6-astra', effort: 'xhigh' }),
});

export const EXPECTED_AGENT_PERMISSIONS = Object.freeze({
  'lit-executor': Object.freeze({ tools: 'Read, Grep, Glob, Bash, Write, Edit, MultiEdit', permissionMode: 'acceptEdits' }),
  'korean-prose-editor': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'default' }),
  'korean-style-analyzer': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'plan' }),
  'librarian-researcher': Object.freeze({ tools: 'Read, Grep, Glob, WebFetch, WebSearch', permissionMode: 'plan' }),
  'meaning-preservation-auditor': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'default' }),
  'native-flow-reviewer': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'default' }),
  'lit-verifier': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'default' }),
  'polish-orchestrator': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'default' }),
  'lit-planner': Object.freeze({ tools: 'Read, Grep, Glob, WebFetch, WebSearch', permissionMode: 'plan' }),
  'qa-runner': Object.freeze({ tools: 'Read, Grep, Glob, Bash', permissionMode: 'default' }),
  'quality-reviewer': Object.freeze({ tools: 'Read, Grep, Glob', permissionMode: 'default' }),
});

const UNSUPPORTED_MESSAGE =
  'LitClaude cannot apply model/effort routes through Claude Code; native model selection remains host-owned and current route behavior stays unchanged.';

const blocked = (code, detail) => ({
  status: 'BLOCKED',
  code,
  apply: false,
  permissionMutation: false,
  message: `BLOCKED: ${detail}`,
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function evaluateRequestedRoute(routeData) {
  if (!isPlainObject(routeData)) {
    return blocked('MALFORMED_ROUTE_DATA', 'route data must be one JSON object');
  }

  if ([...Object.keys(routeData)].some((key) => !ROUTE_FIELDS.has(key))) {
    return blocked('MALFORMED_ROUTE_DATA', 'route data contains an unsupported field');
  }

  if (typeof routeData.route !== 'string' || routeData.route.trim() !== routeData.route || routeData.route.length === 0) {
    return blocked('MALFORMED_ROUTE_DATA', 'route data needs a non-empty route name');
  }
  if (!Object.hasOwn(APPROVED_MODEL_ROUTES, routeData.route)) {
    return blocked('UNKNOWN_ROUTE', 'route name is not in the approved G20 table');
  }

  if (hasOwn(routeData, 'effort') && hasOwn(routeData, 'reasoning_effort')) {
    return blocked('CONFLICTING_EFFORT_FIELDS', 'use one effort field, not both effort and reasoning_effort');
  }

  const effort = routeData.effort ?? routeData.reasoning_effort;
  if (typeof routeData.model !== 'string' || typeof effort !== 'string') {
    return blocked('MALFORMED_ROUTE_DATA', 'route data needs string model and effort values');
  }
  if (!MODEL_IDS.has(routeData.model)) {
    return blocked('UNKNOWN_MODEL', 'model is not in the approved G20 table');
  }
  if (!EFFORTS.has(effort)) {
    return blocked('UNKNOWN_EFFORT', 'effort is not in the approved G20 table');
  }
  if (routeData.model === 'gpt-5.6-luna' && effort === 'xhigh') {
    return blocked('FORBIDDEN_MODEL_EFFORT', 'legacy policy blocks gpt-5.6-luna plus xhigh');
  }

  const expected = APPROVED_MODEL_ROUTES[routeData.route];
  if (expected.model !== routeData.model || expected.effort !== effort) {
    return blocked('ROUTE_POLICY_MISMATCH', 'model and effort do not match the approved route table');
  }

  return {
    ...blocked('CLAUDE_NATIVE_ROUTE_UNSUPPORTED', UNSUPPORTED_MESSAGE),
    routeSupport: 'unsupported',
  };
}

const frontmatterOf = (text) => /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)?.[1] ?? null;
const fieldOf = (frontmatter, field) => frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'mu'))?.[1]?.trim() ?? null;

const collectRouteFields = (value, path = '', fields = []) => {
  if (!isPlainObject(value)) return fields;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'model' || key === 'effort' || key === 'reasoning_effort') fields.push(childPath);
    collectRouteFields(child, childPath, fields);
  }
  return fields;
};

export function inspectClaudeNativeSurface(root = ROOT) {
  const agentsRoot = join(root, 'plugins', 'litclaude', 'agents');
  const manifestPath = join(root, 'plugins', 'litclaude', '.claude-plugin', 'plugin.json');
  const failures = [];
  const modelFields = [];
  const effortFields = [];
  const permissions = {};

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    failures.push('PLUGIN_MANIFEST_UNREADABLE');
    manifest = {};
  }
  for (const field of collectRouteFields(manifest)) {
    if (field.endsWith('.model') || field === 'model') modelFields.push(`plugin.json:${field}`);
    else effortFields.push(`plugin.json:${field}`);
  }

  let agentFiles = [];
  try {
    agentFiles = readdirSync(agentsRoot).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)).sort();
  } catch {
    failures.push('AGENTS_DIRECTORY_UNREADABLE');
  }

  for (const agentName of agentFiles) {
    if (!Object.hasOwn(EXPECTED_AGENT_PERMISSIONS, agentName)) {
      failures.push(`UNEXPECTED_AGENT:${agentName}`);
    }
    let text;
    try {
      text = readFileSync(join(agentsRoot, `${agentName}.md`), 'utf8');
    } catch {
      failures.push(`AGENT_UNREADABLE:${agentName}`);
      continue;
    }
    const frontmatter = frontmatterOf(text);
    if (frontmatter === null) {
      failures.push(`AGENT_FRONTMATTER_MISSING:${agentName}`);
      continue;
    }
    if (fieldOf(frontmatter, 'model') !== null) modelFields.push(`${agentName}:model`);
    if (fieldOf(frontmatter, 'effort') !== null || fieldOf(frontmatter, 'reasoning_effort') !== null) {
      effortFields.push(`${agentName}:effort`);
    }
    const expected = EXPECTED_AGENT_PERMISSIONS[agentName];
    if (!expected) continue;
    const actual = { tools: fieldOf(frontmatter, 'tools'), permissionMode: fieldOf(frontmatter, 'permissionMode') };
    permissions[agentName] = actual;
    if (actual.tools !== expected.tools || actual.permissionMode !== expected.permissionMode) {
      failures.push(`AGENT_PERMISSION_CHANGED:${agentName}`);
    }
  }

  for (const agentName of Object.keys(EXPECTED_AGENT_PERMISSIONS)) {
    if (!Object.hasOwn(permissions, agentName)) failures.push(`AGENT_MISSING:${agentName}`);
  }
  if (modelFields.length > 0) failures.push('MODEL_ROUTE_FIELDS_PRESENT');
  if (effortFields.length > 0) failures.push('EFFORT_ROUTE_FIELDS_PRESENT');

  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    routeSupport: 'unsupported',
    reason: UNSUPPORTED_MESSAGE,
    modelFields: modelFields.sort(),
    effortFields: effortFields.sort(),
    permissions: Object.fromEntries(Object.entries(permissions).sort(([left], [right]) => left.localeCompare(right))),
    failures,
  };
}

const isMainModule = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMainModule()) {
  const report = inspectClaudeNativeSurface();
  if (report.status !== 'PASS') {
    process.stderr.write(`MODEL_ROUTING_GUARD_FAIL: ${report.failures.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`MODEL_ROUTING_GUARD_PASS: ${Object.keys(report.permissions).length} Claude agents checked\n`);
  process.stdout.write(`MODEL_ROUTING_UNSUPPORTED: ${report.reason}\n`);
}
