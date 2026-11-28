<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 노을빛 터미널 화면입니다. LitClaude의 모서리가 둥근 LIT 카드가 단계 지도, 작업 게이지, 스킬 알약, 레인, 컨텍스트 게이지와 함께 화면을 두르고, 가운데는 픽셀 글자 LITFAMILY와 줄무늬 해가 채우며, 일곱 제품 이름 줄에서 LITCLAUDE가 켜지고, 아래에서는 Claude Code 프롬프트에 요청이 입력됩니다." /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">LitClaude는 Claude Code에 붙이는 추가 기능입니다. Claude가 "다 됐어요"라고 말하기 전에 자기 작업을 직접 확인하게 하고, 다음 세션이 이어서 시작할 수 있도록 기록을 남기게 합니다.</p>
<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/readme/badge-version.svg" alt="1.0.69" />
  <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>
<p align="center">
  <a href="https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md">전체 안내와 스킬 갤러리는 GitHub에서</a> · <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/README.md">English</a>
</p>

Claude에게 기능을 하나 부탁하면 코드를 쓰고 끝났다고 말합니다. 그런데 다음 날 보니 테스트는 한 번도 돌지 않았습니다. 새 세션을 열면 프로젝트 설명을 처음부터 다시 해야 합니다.

LitClaude를 쓰면 같은 요청에 `lit`만 붙이면 됩니다. Claude는 먼저 이 작업에서 "끝났다"가 무슨 뜻인지 적고, 실패하는 테스트를 추가해 통과시킨 뒤, 무엇을 확인했고 무엇을 확인하지 못했는지 알려 줍니다. 작업을 멈출 때 `handoff`라고 치면 Claude가 기록을 남기고, 다음 세션이 그 기록을 읽고 이어서 합니다.

## 두 가지 사용법

**간단하게.** 평소처럼 요청을 쓰고, 앞이나 끝에 `lit`을 붙입니다.

```text
src/dates.js의 날짜 파싱 버그 고쳐줘 lit
```

Claude가 목표를 정하고, 실패하는 테스트를 쓰고, 버그를 고치고, 결과를 확인한 뒤 확인한 내용을 알려 줍니다. 대부분의 작업은 이것으로 충분합니다.
`lit`을 끝에 붙여도 앞에 붙인 것과 같습니다. Claude가 `lit` 앞의 말을 목표로 삼을지 한 번 묻고, 끝에 붙인 `lit-loop`나 `litwork`도 제 흐름을 시작합니다.

**본격적으로.** 큰 작업은 한 단계씩 나아갑니다. 각 단계가 남긴 파일을 다음 단계가 읽고, 필요 없는 단계는 건너뛰면 됩니다.

| 단계 | 입력 | 하는 일 |
| --- | --- | --- |
| 1. 넓게 보기 | `/litclaude:lit-brainstorm <질문>` | 선택지를 많이 낸 뒤 점수를 매겨 몇 개로 추립니다 |
| 2. 구체화 | `/litclaude:deep-interview <아이디어>` | 목표가 분명해질 때까지 Claude가 질문합니다 |
| 3. 계획 | `lit-crucible <접근법>` 또는 `/litclaude:lit-plan <작업>` | crucible은 접근법의 약점을 먼저 찌른 뒤 계획으로 넘기고, lit-plan은 단계를 쓰고 승인을 기다립니다 |
| 4. 실행 | 계획에 `yes`, 또는 `/litclaude:lit-loop <작업>` | 테스트와 확인을 거치며 작업합니다 |
| 5. 검토 | `/litclaude:review-work` | 다섯 갈래로 검토하고 발견한 문제부터 알려 줍니다 |
| 6. 넘겨주기 | `handoff` | 결정과 다음 할 일을 파일로 남깁니다 |

설치는 한 줄입니다(자세한 내용은 바로 아래 설치 절에 있습니다). 그다음 프로젝트에서 Claude Code를 실행하세요.

## 설치

Node.js와 npm, 그리고 Claude Code가 있으면 됩니다.

```bash
npx @litfamily/litclaude@latest install
```

처음 실행하면 npx가 패키지를 설치할지 묻는데, `y`로 답하면 됩니다. 설치 프로그램은 플러그인을
등록하고 LitClaude 상태 줄을 붙인 뒤, 짧은 질문을 최대 다섯 개까지 카드로 묻습니다(상태 줄 색상, 출력
스타일, 아이콘 글꼴, Co-Authored-By 줄, `CLAUDE.md` 구역). Enter는 표시된 기본값을 고릅니다. 새로
설치하면 권한 규칙을 더하지 않는 `safe` 권한 모드로 시작하고 나머지 Claude 설정은 그대로 둡니다.
영상 스킬에 필요한 렌더링 엔진과 글꼴도 미리 받아 둡니다. 설치가 끝나면 플러그인이 로드되도록
Claude Code를 다시 시작하세요.

질문 없이 기본값으로 가고 싶다면 `install` 뒤에 `--yes`를 붙이고, 바뀔 내용을 먼저 보고 싶다면
`install` 앞에 `--dry-run`을 두세요(`npx @litfamily/litclaude@latest --dry-run install`). 권한 모드,
버전 고정, 전역 설치와 나머지 스위치는 [안내서](https://github.com/wjgoarxiv/litclaude/blob/main/docs/guide_ko-KR.md#설치-상세)에 있습니다.

## 처음 해 볼 일

프로젝트에서 `claude`를 실행하고 `lit`을 입력한 뒤, 활성화 안내가 나오면 작은 작업을 맡겨 보세요.

```text
외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘.
추가·완료·삭제 동작을 구현하고, 확인한 내용과 다음 행동을 남겨줘.
```

끝나면 파일을 열어 세 동작을 직접 눌러 보세요. 제대로 작동하는지는 그렇게 확인합니다.

| 이렇게 입력하면 | 이런 결과가 나옵니다 |
| --- | --- |
| `lit`, 또는 프롬프트 끝에 `lit` | 근거를 남기며 일하는 작업 루프 |
| `lit plan <내용>` | 아무것도 고치기 전에 세우는 계획과 확인 항목 |
| `/litclaude:start-work <승인한 계획>` | 승인한 계획의 실행 |
| `lit review <범위>` | 찾은 문제와 남은 일 |
| `lit research <질문>` | 출처를 밝힌 공개 자료 조사 |
| `handoff` | 다음 세션을 위한 이어가기 파일 |
| `<발표자료 만들어줘 …> lit`, `<보고서 써줘 …> lit` | 편집할 수 있는 `.pptx`, `.docx` 파일 |
| `lit P&ID 그려줘 …`, `lit 장치도 그려줘` | 검사를 거친 장비 도면(SVG, PDF, PNG) |
| `lit hijack <자료> into <스킬>` | 남이 공개한 기법을 내 스킬로 옮기고 증명한 결과 |
| `lit ultra-brainstorm <주제>` | 아이디어 에이전트 30~300개가 낸 것 중 점수 매긴 상위 10개 |
| `lit team <목표>` | 이 세션이 팀을 굴리고 결과를 알려 줌 |
| `lit adhd`(또는 `lit rewind`), 이어서 `go` | 지금 할 한 가지를 담은 여섯 줄 카드, 그리고 그 일 |
| `lit 엑셀로 정리해줘`, `lit make an xlsx report` | 수식이 살아 있는 Excel 통합 문서(`sheets` 확장) |
| `lit approve`, `lit approve x`, `lit deny`, `lit skip-row` | 긴 작업이 모아 둔 받은편지함에 대한 답 |
| `lit pause`, `lit resume` | 긴 작업을 그 자리에 멈춰 두었다가 다시 이어 가기 |

승인한 계획은 마지막 행까지 진행하고, `## Done when` 확인이 통과하면 스스로 닫힙니다. 내 승인이 필요한 단계는
세워 두고 작업은 계속되며, 끝에 받은편지함 하나가 기다리는 것을 모아 보여 줍니다. Claude가 할 수 없던 행에는
`IMPOSSIBLE: <이유>`가 붙습니다. 계획에 `Run charter: commit on <branch> in <repo>` 줄이 있으면 그 브랜치에서
커밋할 수 있고, `goal: native` 줄이 있으면 Claude Code의 `/goal`이 함께하되 언제나 스스로 끝납니다. `lit` 없이 요청해도
Claude가 맞는 스킬을 후보로 받아 불러올지 정합니다.

Claude 데스크톱 앱과 모바일 앱(Claude Code 2.1.325 이상)에서는 LitClaude가 앱에 Ignition 룩도 입힙니다. LitFamily 색과
LIT 상태를 따라 쉬고, 타오르고, 신호를 보내고, 터지는 신스웨이브 노을 배경입니다. `npx @litfamily/litclaude@latest config look still`은
움직임만 끄고, `look off`는 앱 본래의 모습으로 되돌립니다.

## 확인, 업데이트, 제거

```bash
npx @litfamily/litclaude@latest doctor
npx @litfamily/litclaude@latest update
npx @litfamily/litclaude@latest uninstall
```

새 Claude Code 세션이 하루 한 번까지 새 버전을 확인하고, 이후 세션이 설치하므로, `update`는
지금 바로 올리고 싶을 때 쓰면 됩니다. LitClaude는 프로젝트 상태를 `.litclaude/`에 두고, 그 안의 `.gitignore`로 Git이 이 폴더를 건너뛰게
합니다. 이 상태는 npm 패키지에 들어가지 않습니다. `uninstall`은 LitClaude가 관리하는 항목만 지우고,
직접 수정한 설치는 건드리지 않습니다. Claude Code 마켓플레이스로 추가한 플러그인에는 상태 줄이 없고,
업데이트와 제거는 `/plugin` 메뉴에서 합니다.

이 명령들은 신스웨이브 LIT 마크로 시작합니다. 색이 없는 터미널에서는 기호로만 그리고, UTF-8을 쓰지 않는 터미널이나
파이프로 넘긴 출력에는 `LIT · claude code` 한 줄만 나옵니다. 일하는 동안 프롬프트 위 카드가 지금 단계를 보여 주고, 빈자리에는 움직이는 노을이 뜹니다. 세션이 비정상으로 끝나 남은 잠금은 저절로 풀립니다. 그래도
`state lock timed out`이 보이면 그 프로젝트의 Claude Code 세션을 닫고 메시지에 적힌 잠금 폴더를 지우면 됩니다.

## 더 보기

- [전체 안내와 스킬 갤러리 (GitHub)](https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md)
- [개인정보와 네트워크 동작](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/privacy.md)
- [이전과 소유권 충돌](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/migration.md)
- [변경 이력](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/CHANGELOG.md)
- [MIT 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/LICENSE)
