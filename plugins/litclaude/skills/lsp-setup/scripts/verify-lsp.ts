#!/usr/bin/env node
// verify-lsp.ts <file> [--timeout=ms] [--config=<path>] — perform a real LSP
// diagnostics roundtrip for <file>: resolve the server for the file extension
// (from plugins/litclaude/.lsp.json when present, else the embedded table),
// spawn it, run the JSON-RPC initialize -> initialized -> didOpen handshake over
// stdio, wait for textDocument/publishDiagnostics, and report OK / FAIL / SKIP.
//
// Dependency-free: uses only node:child_process and node:fs. No monorepo imports.
//
// Runtime: Node 22.6+ with `node --experimental-strip-types`, or `bun`.
//   node --experimental-strip-types scripts/verify-lsp.ts <file>
//   bun scripts/verify-lsp.ts <file>
//
// Exit codes: 0 OK, 1 FAIL (server error / not installed), 2 usage, 3 SKIP
// (no server known for this extension).

import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, isAbsolute, resolve, win32 } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"

import { LANGUAGES, LSP_CONFIG_FILE } from "./lsp-server-table.ts"

const DEFAULT_TIMEOUT_MS = 60_000

const NPM_SHIM_TARGET = /"%~?dp0%?\\([^"\r\n]+)"\s+%\*/gu

interface ShellFreeHost {
	readonly platform?: string
	readonly env?: Record<string, string | undefined>
	readonly execPath?: string
	readonly exists?: (file: string) => boolean
	readonly read?: (file: string) => string
}

// Language servers installed with npm are .cmd shims on Windows, which Node will not spawn without
// a shell (CVE-2024-27980). The server is found with PATHEXT (never the extensionless sh script npm
// writes beside the shim) and a shim is unwrapped to the script it launches, run with this Node, or
// to its binary, so no argument passes through cmd.exe. A .cmd that is not an npm shim throws.
export function shellFreeCommand(name: string, args: readonly string[], host: ShellFreeHost = {}): { command: string; args: string[] } {
	const platform = host.platform ?? process.platform
	if (platform !== "win32") return { command: name, args: [...args] }
	const env = host.env ?? process.env
	const exists = host.exists ?? existsSync
	const read = host.read ?? ((file: string) => readFileSync(file, "utf8"))
	const extensions = (env["PATHEXT"] || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
	const names = extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase())) ? [name] : extensions.map((ext) => name + ext)
	const dirs = /[\\/]/u.test(name) ? [""] : (env["PATH"] ?? env["Path"] ?? "").split(";").filter(Boolean)
	let found: string | undefined
	for (const dir of dirs) {
		found = names.map((file) => (dir ? win32.join(dir, file) : file)).find((file) => exists(file))
		if (found) break
	}
	if (!found) return { command: name, args: [...args] }
	if (!/\.(?:cmd|bat)$/iu.test(found)) return { command: found, args: [...args] }
	const target = [...read(found).matchAll(NPM_SHIM_TARGET)].at(-1)?.[1]
	if (!target) throw new Error(`${found} is not an npm shim and cannot run without a shell; put the program's .exe on PATH instead`)
	const resolved = win32.join(win32.dirname(found), target)
	return /\.[cm]?js$/iu.test(resolved)
		? { command: host.execPath ?? process.execPath, args: [resolved, ...args] }
		: { command: resolved, args: [...args] }
}

interface ResolvedServer {
	readonly language: string
	readonly command: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
}

// Resolve the server command for `ext`, preferring a LitClaude .lsp.json entry
// whose `extensionToLanguage` maps the extension, then the embedded table.
function resolveServer(ext: string, configPath: string): ResolvedServer | null {
	if (existsSync(configPath)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"))
			if (isRecord(parsed)) {
				for (const [language, entry] of Object.entries(parsed)) {
					if (!isRecord(entry)) continue
					const map = entry["extensionToLanguage"]
					const command = entry["command"]
					if (isRecord(map) && Object.keys(map).includes(ext) && isStringArray(command)) {
						return { language, command }
					}
				}
			}
		} catch {
			// fall through to embedded table
		}
	}

	for (const server of LANGUAGES) {
		if (server.extensions.includes(ext)) {
			return { language: server.language, command: [...server.command] }
		}
	}
	return null
}

interface JsonRpcMessage {
	readonly method?: string
	readonly id?: number
	readonly params?: unknown
	readonly result?: unknown
	readonly error?: unknown
}

function encode(message: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(message), "utf-8")
	return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body])
}

// Incremental LSP framing parser: pulls complete Content-Length messages off a
// growing buffer.
function makeReader(onMessage: (message: JsonRpcMessage) => void): (chunk: Buffer) => void {
	let buffer = Buffer.alloc(0)
	return (chunk: Buffer): void => {
		buffer = Buffer.concat([buffer, chunk])
		while (true) {
			const headerEnd = buffer.indexOf("\r\n\r\n")
			if (headerEnd === -1) return
			const header = buffer.subarray(0, headerEnd).toString("ascii")
			const match = /content-length:\s*(\d+)/i.exec(header)
			if (!match) {
				buffer = buffer.subarray(headerEnd + 4)
				continue
			}
			const length = Number.parseInt(match[1] ?? "0", 10)
			const start = headerEnd + 4
			if (buffer.length < start + length) return
			const body = buffer.subarray(start, start + length).toString("utf-8")
			buffer = buffer.subarray(start + length)
			try {
				onMessage(JSON.parse(body) as JsonRpcMessage)
			} catch {
				// ignore malformed frame
			}
		}
	}
}

function languageId(ext: string): string {
	const server = LANGUAGES.find((entry) => entry.extensions.includes(ext))
	return server?.language ?? ext.replace(/^\./, "")
}

async function run(filePath: string, timeoutMs: number, configPath: string): Promise<number> {
	const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
	const ext = extname(absolute).toLowerCase()
	const server = resolveServer(ext, configPath)

	if (server === null) {
		process.stderr.write(`SKIP ${absolute}: no language server known for "${ext}". See references/.\n`)
		return 3
	}

	const [bin, ...binArgs] = server.command
	if (bin === undefined) {
		process.stderr.write(`SKIP ${absolute}: empty command for ${server.language}.\n`)
		return 3
	}

	const text = readFileSync(absolute, "utf-8")
	const uri = pathToFileURL(absolute).href

	return await new Promise<number>((resolveResult) => {
		let child
		try {
			const invocation = shellFreeCommand(bin, binArgs)
			child = spawn(invocation.command, invocation.args, { stdio: ["pipe", "pipe", "pipe"] })
		} catch (error) {
			const why = error instanceof Error && /not an npm shim/u.test(error.message) ? error.message : `language server not installed (${bin})`
			process.stdout.write(`FAIL ${absolute}: ${why}\n`)
			resolveResult(1)
			return
		}

		let settled = false
		let stderr = ""
		const finish = (code: number, line: string): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			try {
				child.kill("SIGKILL")
			} catch {
				/* already gone */
			}
			process.stdout.write(`${line}\n`)
			resolveResult(code)
		}

		const timer = setTimeout(() => {
			finish(1, `FAIL ${absolute}: timed out after ${timeoutMs}ms waiting for diagnostics`)
		}, timeoutMs)

		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				finish(1, `FAIL ${absolute}: language server not installed (${bin})`)
			} else {
				finish(1, `FAIL ${absolute}: ${error.message}`)
			}
		})
		child.on("exit", (code) => {
			if (!settled) {
				finish(1, `FAIL ${absolute}: server exited (code ${code ?? "?"})\n${stderr.trim()}`)
			}
		})
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8")
		})

		const send = (message: unknown): void => {
			child.stdin.write(encode(message))
		}

		const read = makeReader((message) => {
			if (message.id === 1 && message.result !== undefined) {
				send({ jsonrpc: "2.0", method: "initialized", params: {} })
				send({
					jsonrpc: "2.0",
					method: "textDocument/didOpen",
					params: { textDocument: { uri, languageId: languageId(ext), version: 1, text } },
				})
			}
			if (message.method === "textDocument/publishDiagnostics" && isRecord(message.params)) {
				const diagnostics = message.params["diagnostics"]
				const count = Array.isArray(diagnostics) ? diagnostics.length : 0
				if (message.params["uri"] === uri) {
					finish(0, `OK ${absolute}: LSP roundtrip succeeded (${count} diagnostic(s)) via ${server.language}`)
				}
			}
		})
		child.stdout.on("data", read)

		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				processId: process.pid,
				rootUri: pathToFileURL(process.cwd()).href,
				capabilities: { textDocument: { publishDiagnostics: {} } },
			},
		})
	})
}

function parseTimeout(args: readonly string[]): number {
	const flag = args.find((arg) => arg.startsWith("--timeout="))
	if (flag === undefined) return DEFAULT_TIMEOUT_MS
	const parsed = Number.parseInt(flag.slice("--timeout=".length), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const configFlag = args.find((arg) => arg.startsWith("--config="))
	const configPath = configFlag ? configFlag.slice("--config=".length) : LSP_CONFIG_FILE
	const filePath = args.find((arg) => !arg.startsWith("--"))

	if (filePath === undefined) {
		process.stderr.write("Usage: verify-lsp.ts <file> [--timeout=ms] [--config=<path>]\n")
		process.exit(2)
	}
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		process.stderr.write(`verify-lsp: not a file: ${filePath}\n`)
		process.exit(2)
	}

	const code = await run(filePath, parseTimeout(args), configPath)
	process.exit(code)
}

// Run only when invoked directly, so the resolver above can be imported and tested.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
