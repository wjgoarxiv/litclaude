# LitClaude 개발

[README](../README_ko-KR.md) · [안내서](./guide_ko-KR.md) · [기여 안내](../CONTRIBUTING.md) · [English](./development.md)

LitClaude 자체를 고치는 사람을 위한 페이지입니다. 패키지 guard가 보장하는 범위, pull request
전에 돌릴 검사, checkout에서 플러그인을 불러오는 방법, 파일 위치를 정리했습니다.

## 무결성 경계

스캐너 통과는 한 시점의 스냅샷에 대한 결과입니다. 캡처한 파일 수와 그 바이트의 SHA-256
다이제스트를 알려 주지만, 그 뒤에도 mutable live tree가 깨끗하다는 것까지 입증하지는 않습니다.
파일이 바뀌었다면 검사를 다시 돌리세요. 법적 동반 파일은 생성된 manifest 밖에 있고 정상적으로
검사합니다. Canonical 및 runtime 캡처는 파일당 8 MiB, 전체 32 MiB까지입니다.
패키지 guard는 `immutable expected file map`을 `verifier-to-capture interval` 안에서 확인하고,
만들어진 tarball과도 비교합니다. `0600` 같은 `non-executable` 항목도 유효합니다.

## Checkout 검증 명령

이 checkout의 주요 gate입니다.

```bash
npm test
npm run validate:plugin
npm run doctor
npm run check:version
npm run scan:legacy-tokens
npm run check:skill-resources
npm run check:runtime-closures
npm run pack:payload-guard
npm run pack:dry-run
```

## 로컬 개발

checkout에서 plugin을 직접 로드합니다.

```bash
claude --plugin-dir ./plugins/litclaude
```

Claude Code 안에서는 다음 명령으로 plugin metadata를 다시 읽습니다.

```text
/reload-plugins
```

## 프로젝트 지도

| Surface | Path |
| --- | --- |
| CLI | `bin/litclaude-ai.js` |
| Claude plugin | `plugins/litclaude/` |
| Skills | `plugins/litclaude/skills/` |
| Agents | `plugins/litclaude/agents/` |
| Hooks | `plugins/litclaude/hooks/hooks.json` |
| MCP | `plugins/litclaude/.mcp.json` |
| LSP | `plugins/litclaude/.lsp.json` |

npm 패키지 페이지에는 더 짧은 README가 올라갑니다. 원본은 `README_npm_ko-KR.md`(영문은
`README_npm.md`)이고, pack이나 publish 전에 `node tools/readme-for-npm.mjs apply`가 그 파일로
바꿔 넣으며 `restore`가 GitHub README를 되돌려 놓습니다. 배포 절차는
[`RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md)에 있습니다.

소스 트리의 `docs/assets/cover.svg`는 편집 가능한 저대역폭 대체 표지로 남아 있습니다. 정적 제품
강조 표지 `docs/assets/cover.webp`, 워드마크 `docs/assets/litclaude-wordmark.svg`, 클레이 마크
`docs/assets/litclaude-clay-icon.png`는 패키지에 계속 포함되지만 README에는 더 이상 표시하지
않습니다.
