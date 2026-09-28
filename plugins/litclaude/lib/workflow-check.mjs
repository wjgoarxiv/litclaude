import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const includesAll = (text, terms) => terms.every((term) => text.includes(term));

const readText = (path) => readFileSync(path, "utf8");

const runHookProbe = (root, env) => {
  const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
		env,
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "lit workflow verify delegation",
      cwd: root,
    }),
  });
  if (result.status !== 0) return "";
  try {
    return JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? "";
  } catch {
    return "";
  }
};

const envFlag = (env, name) => String(env[name] ?? "").trim() === "1";

const hostSettingsCapability = (root, env) => {
  const home = String(env.HOME ?? "").trim();
  const configDir = String(env.CLAUDE_CONFIG_DIR ?? env.CLAUDE_HOME ?? (home ? join(home, ".claude") : "")).trim();
  const managedRoots = [
    "/Library/Application Support/ClaudeCode",
    "/etc/claude-code",
    String(env.LITCLAUDE_TEST_MANAGED_SETTINGS_ROOT ?? "").trim(),
  ].filter((path, index, paths) => path && paths.indexOf(path) === index);
  let managedDirectoryError = null;
  const managedCandidates = managedRoots.flatMap((managedRoot) => {
    const directory = join(managedRoot, "managed-settings.d");
    let fragments = [];
    try {
      fragments = existsSync(directory)
        ? readdirSync(directory)
          .filter((name) => name.endsWith(".json"))
          .sort()
          .map((name) => join(directory, name))
        : [];
    } catch {
      managedDirectoryError = directory;
    }
    return [join(managedRoot, "managed-settings.json"), ...fragments];
  });
  const candidates = [
    ...managedCandidates,
    configDir ? join(configDir, "settings.json") : "",
    configDir ? join(configDir, "settings.local.json") : "",
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
  ].filter((path, index, paths) => path && paths.indexOf(path) === index);
  const sources = [];
  const gates = new Set();
	if (managedDirectoryError !== null) {
		return { status: "unreadable", sources: [managedDirectoryError], gates: [], reason: "managed-directory-unreadable" };
	}

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    sources.push(path);
    let settings;
    try {
      settings = JSON.parse(readText(path));
    } catch {
      return { status: "unreadable", sources, gates: [], reason: "malformed-json" };
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return { status: "unreadable", sources, gates: [], reason: "invalid-json-shape" };
    }
    if (settings.disableWorkflows === true) gates.add("disableWorkflows");
    if (settings.enableWorkflows === false) gates.add("enableWorkflows");
    if (settings.disableAgentView === true) gates.add("disableAgentView");
  }

  return { status: "readable", sources, gates: [...gates], reason: null };
};

const concurrencyCapability = (env) => {
	const raw = String(env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY ?? "").trim();
	if (!raw) return { status: "host-default", source: "Claude Code default", limit: null };
	const limit = /^[1-9]\d*$/u.test(raw) ? Number(raw) : Number.NaN;
	return Number.isInteger(limit) && limit > 1
		? { status: "configured", source: "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY", limit }
		: { status: "unavailable", source: "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY", limit: Number.isInteger(limit) ? limit : null };
};

export const createWorkflowCheckReport = (root, version, env = process.env) => {
  const commandPath = join(root, "plugins", "litclaude", "commands", "lit-loop.md");
  const agentsPath = join(root, "docs", "agents.md");
  const skillsRoot = join(root, "plugins", "litclaude", "skills");
	const hookContext = runHookProbe(root, env);
	const toolConcurrency = concurrencyCapability(env);
	const hostSettings = hostSettingsCapability(root, env);
	const settingsDisableWorkflows = hostSettings.gates.some((gate) => gate === "disableWorkflows" || gate === "enableWorkflows");
	const settingsDisableAgentView = hostSettings.gates.includes("disableAgentView");
	const workflowsEnabled = hostSettings.status === "readable" && !envFlag(env, "CLAUDE_CODE_DISABLE_WORKFLOWS") && !settingsDisableWorkflows;
	const backgroundTasksEnabled = hostSettings.status === "readable" && !envFlag(env, "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS") && !settingsDisableAgentView;
  const commandText = existsSync(commandPath) ? readText(commandPath) : "";
  const agentsText = existsSync(agentsPath) ? readText(agentsPath) : "";
  const orchestrationSkillText = ["lit-loop", "lit-plan", "start-work", "review-work"]
    .map((skillName) => {
      const path = join(skillsRoot, skillName, "SKILL.md");
      return existsSync(path) ? readText(path) : "";
    })
    .join("\n");
  const reliabilityTerms = ["TASK:", "DELIVERABLE", "SCOPE", "VERIFY", "short wait", "missing deliverable", "BLOCKED:"];

  const checks = {
		hostSettingsReadable: hostSettings.status === "readable",
		hostWorkflowsEnabled: workflowsEnabled,
		backgroundTasksEnabled,
		toolConcurrencyAboveOne: toolConcurrency.status !== "unavailable",
    goalGuidance: includesAll(`${hookContext}\n${commandText}`, ["get_goal", "create_goal", "update_goal", "/goal"]),
    dynamicWorkflowGuidance: includesAll(`${hookContext}\n${commandText}`, ["Workflow", "EnterWorktree", "claude --worktree"]),
    subagentDelegation: includesAll(`${hookContext}\n${commandText}\n${agentsText}`, [
      "lit-planner",
      "lit-executor",
      "lit-verifier",
      "qa-runner",
    ]),
    subagentReliability: includesAll(`${hookContext}\n${commandText}\n${orchestrationSkillText}`, reliabilityTerms),
    commandHookAgreement: includesAll(hookContext, reliabilityTerms) && includesAll(commandText, reliabilityTerms),
    dynamicWorkflowCommand: existsSync(commandPath),
    hookRoute: hookContext.includes("/litclaude:lit-loop"),
  };

  const missing = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    status: missing.length === 0 ? "pass" : "fail",
    version,
    checks,
		capabilities: {
			hostSettings: {
				...hostSettings,
				remoteOrganizationPolicy: "not-locally-observable",
			},
			workflows: {
				status: workflowsEnabled ? "enabled" : "unavailable",
				source: "environment + Claude settings",
			},
			backgroundTasks: {
				status: backgroundTasksEnabled ? "enabled" : "unavailable",
				source: "environment + Claude settings",
			},
			toolConcurrency,
			agentTeams: {
				status: envFlag(env, "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS") ? "enabled" : "optional-disabled",
				source: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
			},
		},
    missing,
  };
};

export const runWorkflowCheckCli = (root, version, args, io = { stdout: process.stdout, stderr: process.stderr }) => {
  const outputJson = args.includes("--json");
  const report = createWorkflowCheckReport(root, version);
  if (outputJson) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(`WORKFLOW_CHECK_${report.status.toUpperCase()}\n`);
    for (const [name, passed] of Object.entries(report.checks)) {
      io.stdout.write(`${name}=${passed ? "pass" : "fail"}\n`);
    }
    if (report.missing.length) io.stdout.write(`missing=${report.missing.join(",")}\n`);
  }
  return report.status === "pass" ? 0 : 1;
};
