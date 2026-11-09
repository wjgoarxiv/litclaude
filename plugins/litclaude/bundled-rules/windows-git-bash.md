---
description: Shell expectations when LitClaude runs on Windows under Git Bash.
alwaysApply: true
---

This session is running on Windows. Shell commands reach a Git Bash-style environment,
not cmd.exe or PowerShell, so a few defaults differ from a Linux or macOS host.

- Use POSIX paths (`/c/Users/...`) in shell commands. A Windows path with backslashes is
  read as escape sequences by the shell.
- Prefer forward slashes everywhere, including arguments to Node scripts. Node accepts
  them on Windows.
- `rm`, `ls`, `grep`, and friends are the Git Bash builds. Flags that only exist in GNU
  coreutils may be missing; check before relying on one.
- Line endings: files may arrive with CRLF. Normalize before comparing file content, and
  do not "fix" line endings in files the task did not ask you to touch.
- Process and port cleanup differs. `lsof` is usually absent; use `netstat -ano` and
  `taskkill //PID <pid> //F` (double slashes escape the Git Bash path conversion).
