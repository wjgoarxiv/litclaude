<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitClaude 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">Claude Code에서 계획하고, 만들고, 확인한 일을 다음 세션으로 이어가세요.</p>
<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/readme/badge-version.svg" alt="1.0.14" />
  <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>
<p align="center">
  <a href="https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md">전체 안내, 스킬 갤러리, A/B 결과는 GitHub에서</a> · <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/README.md">English</a>
</p>

LitClaude는 Claude Code 플러그인입니다. 요청 끝에 `lit`을 붙이면 Claude가 목표를 먼저
고정하고, 실패하는 테스트부터 쓰고, 실제 화면에서 확인한 뒤 프로젝트에 기록을 남깁니다.
다음 세션은 그 기록을 읽고 멈춘 자리에서 이어갑니다.

## 설치

Node.js와 npm, 그리고 Claude Code가 있으면 됩니다.

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yes
```

`--yes`는 설치 질문을 건너뜁니다. 새로 설치하면 권한 규칙을 하나도 더하지 않는 `safe`
권한 모드가 적용되고, 다른 Claude 설정은 그대로 둡니다. Claude가 덜 자주 묻게 하고 싶다면
더 넓은 모드를 직접 고르세요.

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --permission-mode balanced
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yolo
```

`balanced`는 제한된 read/search와 routine Git, npm, Node rule을 더하고, `yolo`는 더 넓은
edit/write pattern을 더합니다. LitClaude는 자신이 넣은 rule만 추적하고 그것만 지웁니다.

설치 중에는 네트워크도 씁니다. 고정된 engine package를 `npm ci`로 설치하고, 고정된
font를 내려받아 sha256으로 확인해 motion runtime을 미리 준비합니다. 이 단계가 실패해도 설치는
그대로 끝나고, 나중에 실행할 명령을 알려 줍니다. 건너뛰려면 `LITCLAUDE_MOTION_PREWARM=0`을
설정하고, 필요할 때 `litclaude-ai motion-runtime install`을 실행하세요.
`npm install -g @litfamily/litclaude`로 전역 설치하면 postinstall hook이 같은 설정을 실행합니다.
이것까지 건너뛰려면 `LITCLAUDE_AUTO_INSTALL=0`이나 `LITCLAUDE_POSTINSTALL_SKIP=1`을 설정하거나
`--ignore-scripts`를 붙이세요.

## 처음 해 볼 일

평소처럼 Claude Code를 실행합니다.

```bash
claude
```

`lit`을 입력하고, 활성화 안내가 나오면 작은 작업 하나를 맡겨 보세요.

```text
외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘.
추가·완료·삭제 동작을 구현하고, 확인한 내용과 다음 행동을 남겨줘.
```

끝나면 파일을 직접 열어 눌러 보세요. 파일이 생겼다고 동작까지 확인된 것은 아닙니다.

## 자주 쓰는 입력

| 입력 | 얻는 것 |
| --- | --- |
| `lit`, 또는 프롬프트 끝에 `lit` | 근거 중심 작업 루프 |
| `lit plan <what>` | 파일을 고치기 전에 세우는 계획과 확인 기준 |
| `/litclaude:start-work <승인된 계획>` | 승인한 계획의 실행 |
| `lit review <scope>` | 확인한 점과 남은 일 |
| `lit research <question>` | 출처를 밝힌 public-source 조사 |
| `handoff` | 다음 세션에 건넬 파일 |
| `<발표자료 만들어줘 …> lit`, `<보고서 써줘 …> lit` | 바로 고칠 수 있는 `.pptx`, `.docx` 파일 |

세션을 마칠 때 `handoff`를 입력하고, 알려 준 파일 경로를 챙겨 두세요. 다음에 같은 프로젝트를
열어 그 파일을 읽고 현재 상태와 다음 할 일을 확인해 달라고 하면 됩니다.

LitClaude에는 직접 부르는 스킬 35개가 들어 있습니다. 모호한 요청을 다듬는 `deep-interview`와
`lit-crucible`부터 `lit-diagram-drawer`, `lit-scientific-visualization`, `debugging`,
`refactor`, `lit-commit`까지 있고, 따로 부르지 않아도 도는 `rules`, `lsp`, `comment-checker`
세 개가 더 있습니다. GitHub 페이지에서 A/B 결과와 함께 스킬마다 그림을 붙여 보여 줍니다.

## 설치 후 달라지는 것

- Claude Code에 LitClaude 플러그인이 들어옵니다. 스킬, 명령, 에이전트, hook이 함께 들어옵니다.
- 상태 줄에 LitClaude HUD가 나타납니다. `[🔥LITCLAUDE vX.Y.Z]`, `ctx [▎░░]` context bar,
  `5h [▏░] 4% ↻` rate-limit 리셋 카운트다운을 보여 줍니다.
- 권한 규칙은 `--permission-mode balanced`나 `--yolo`를 고를 때만 바뀝니다. 출력 스타일도
  직접 고를 때만 기록합니다.
- 목표를 연결한 작업은 프로젝트의 `.litclaude/litgoal/`에 상태를 남깁니다. 세션이 닫힌 뒤
  계속 돌거나 저절로 재개되는 것은 없습니다.

선택 기능인 Jev 스킬 힌트는 기본으로 꺼져 있습니다. `LITCLAUDE_JEV=1`과 본인의
`TYPESAFE_API_KEY`로 켜면, 해당하는 프롬프트를 2,000자로 자르고 홈 경로, 이메일 주소,
토큰 모양의 문자열을 가린 뒤 TypeSafe로 보냅니다. 그 밖의 내용은 적힌 그대로 전송되고,
비용은 본인의 TypeSafe 계정에 청구됩니다. export한 키는 에이전트의 도구도 읽을 수 있으니,
이 기능 전용 키를 만들고 사용 한도를 낮게 잡아 두세요. 켜기 전에 GitHub 안내를 먼저 읽어 주세요.

## 안전과 제거

Hook은 제한된 Claude Code event JSON을 읽을 뿐, 입력한 prompt text를 실행하지 않습니다.
프로젝트 로컬 LitClaude 상태는 gitignore되며 npm 패키지에 들어가지 않습니다. 자동 업데이트
확인은 `--no-auto-update`, `LITCLAUDE_NO_AUTO_UPDATE`, `NO_UPDATE_NOTIFIER`,
`LITCLAUDE_NO_UPDATE_CHECK`로 끌 수 있습니다.

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude doctor
npm exec --yes --package @litfamily/litclaude@latest -- litclaude uninstall
```

`uninstall`은 LitClaude가 관리한 plugin, HUD, permission, local state만 지웁니다. 다른
Claude 설정은 건드리지 않고, 수정되었거나 소유권을 확인할 수 없는 설치는 거절합니다.

## 더 보기

- [전체 안내, 스킬 갤러리, A/B 결과 (GitHub)](https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md)
- [개인정보와 네트워크](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/privacy.md)
- [이전 안내와 소유권 충돌](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/migration.md)
- [Release history](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/CHANGELOG.md)
- [MIT 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/LICENSE)
