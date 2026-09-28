// Standalone snapshot of the primary language server per supported language,
// embedded so detect-lsp.ts runs without any external dependency in any project.
// Each entry mirrors the per-language references/<language>/README.md and the
// LitClaude .lsp.json shape, which is keyed by language name:
//   { "<language>": { "command": [...], "extensionToLanguage": { ".ext": "<lang>" } } }
// Edit this table when a reference README changes.

export interface LanguageServer {
	readonly language: string
	readonly command: readonly string[]
	readonly extensions: readonly string[]
	readonly installHint: string
}

export const LANGUAGES: readonly LanguageServer[] = [
	{
		language: "typescript",
		command: ["typescript-language-server", "--stdio"],
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
		installHint: "npm install -g typescript-language-server typescript",
	},
	{
		language: "python",
		command: ["basedpyright-langserver", "--stdio"],
		extensions: [".py", ".pyi"],
		installHint: "pip install basedpyright (or: uv tool install basedpyright)",
	},
	{
		language: "go",
		command: ["gopls"],
		extensions: [".go"],
		installHint: "go install golang.org/x/tools/gopls@latest",
	},
	{
		language: "rust",
		command: ["rust-analyzer"],
		extensions: [".rs"],
		installHint: "rustup component add rust-analyzer",
	},
	{
		language: "c-cpp",
		command: ["clangd", "--background-index", "--clang-tidy"],
		extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
		installHint: "macOS: brew install llvm | Linux: apt install clangd | https://clangd.llvm.org/installation",
	},
	{
		language: "java",
		command: ["jdtls"],
		extensions: [".java"],
		installHint: "macOS: brew install jdtls | https://github.com/eclipse-jdtls/eclipse.jdt.ls",
	},
	{
		language: "kotlin",
		command: ["kotlin-lsp"],
		extensions: [".kt", ".kts"],
		installHint: "https://github.com/Kotlin/kotlin-lsp",
	},
	{
		language: "csharp",
		command: ["csharp-ls"],
		extensions: [".cs"],
		installHint: "dotnet tool install -g csharp-ls",
	},
	{
		language: "razor",
		command: ["roslyn-language-server", "--stdio"],
		extensions: [".razor", ".cshtml"],
		installHint: "dotnet tool install -g roslyn-language-server --prerelease (see references/csharp/README.md)",
	},
	{
		language: "swift",
		command: ["sourcekit-lsp"],
		extensions: [".swift", ".objc", ".objcpp"],
		installHint: "Included with Xcode (xcode-select --install) or the Swift toolchain",
	},
	{
		language: "ruby",
		command: ["rubocop", "--lsp"],
		extensions: [".rb", ".rake", ".gemspec", ".ru"],
		installHint: "gem install rubocop (the builtin runs `rubocop --lsp`)",
	},
	{
		language: "php",
		command: ["intelephense", "--stdio"],
		extensions: [".php"],
		installHint: "npm install -g intelephense",
	},
	{
		language: "dart",
		command: ["dart", "language-server", "--lsp"],
		extensions: [".dart"],
		installHint: "Included with the Dart/Flutter SDK",
	},
	{
		language: "elixir",
		command: ["elixir-ls"],
		extensions: [".ex", ".exs"],
		installHint: "https://github.com/elixir-lsp/elixir-ls",
	},
	{
		language: "zig",
		command: ["zls"],
		extensions: [".zig", ".zon"],
		installHint: "https://github.com/zigtools/zls (match zls version to your zig version)",
	},
	{
		language: "lua",
		command: ["lua-language-server"],
		extensions: [".lua"],
		installHint: "macOS: brew install lua-language-server | https://github.com/LuaLS/lua-language-server",
	},
	{
		language: "bash",
		command: ["bash-language-server", "start"],
		extensions: [".sh", ".bash", ".zsh", ".ksh"],
		installHint: "npm install -g bash-language-server",
	},
	{
		language: "yaml",
		command: ["yaml-language-server", "--stdio"],
		extensions: [".yaml", ".yml"],
		installHint: "npm install -g yaml-language-server",
	},
	{
		language: "terraform",
		command: ["terraform-ls", "serve"],
		extensions: [".tf", ".tfvars"],
		installHint: "macOS: brew install hashicorp/tap/terraform-ls | https://github.com/hashicorp/terraform-ls",
	},
	{
		language: "haskell",
		command: ["haskell-language-server-wrapper", "--lsp"],
		extensions: [".hs", ".lhs"],
		installHint: "ghcup install hls",
	},
	{
		language: "julia",
		command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
		extensions: [".jl"],
		installHint: "julia -e 'using Pkg; Pkg.add(\"LanguageServer\")' (see references/julia/README.md)",
	},
] as const

// The LitClaude LSP config file, relative to the plugin root. detect-lsp.ts also
// accepts an explicit path so it can be pointed at a project copy.
export const LSP_CONFIG_FILE = "plugins/litclaude/.lsp.json"
