<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitClaude 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">Claude Code에서 세션마다 계획하고, 만들고, 확인한 뒤 다음 세션이 이어받을 기록을 남기게 돕는 플러그인입니다.</p>
<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/readme/badge-version.svg" alt="1.0.28" />
  <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>
<p align="center">
  <a href="https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md">전체 안내와 스킬 갤러리는 GitHub에서</a> · <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/README.md">English</a>
</p>

Claude Code 프롬프트에 `lit`을 붙이면 Claude가 목표를 고정하고, 실패하는 테스트를 먼저 쓰고,
실제 결과를 확인한 뒤 프로젝트에 기록을 남깁니다. 작업을 멈출 때 `handoff`를 입력하면 다음
세션이 그 기록을 읽고 이어갑니다.

## 설치

Node.js와 npm, 그리고 Claude Code가 있으면 됩니다.

```bash
npx @litfamily/litclaude@latest install
```

처음 실행하면 npx가 패키지를 설치할지 묻는데, `y`로 답하면 됩니다. 설치 프로그램은 플러그인을
등록하고 LitClaude 상태 줄을 붙인 뒤, 상태 줄 색상과 쓰고 싶은 출력 스타일을 묻습니다.
`install --yes`는 기본값으로 진행하고, `npx @litfamily/litclaude@latest --dry-run install`은 바뀔
내용만 보여 줍니다. 새로
설치하면 권한 규칙을 더하지 않는 `safe` 권한 모드로 시작하고 나머지 Claude 설정은 그대로 둡니다.
영상 스킬에 필요한 렌더링 엔진과 글꼴도 미리 받아 둡니다. 권한 모드, 버전 고정, 전역 설치와 모든
스위치는 [안내서](https://github.com/wjgoarxiv/litclaude/blob/main/docs/guide_ko-KR.md#설치-상세)에 있습니다.

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

선택 기능인 Jev 스킬 힌트는 기본으로 꺼져 있습니다. 켜면 프롬프트가 외부 서비스 TypeSafe로
전송되니 [설명 페이지](https://github.com/wjgoarxiv/litclaude/blob/main/docs/jev_ko-KR.md)를 먼저 읽어 주세요.

## 확인, 업데이트, 제거

```bash
npx @litfamily/litclaude@latest doctor
npx @litfamily/litclaude@latest update
npx @litfamily/litclaude@latest uninstall
```

LitClaude는 프로젝트 상태를 `.litclaude/`에 두고, 그 안의 `.gitignore`로 Git이 이 폴더를 건너뛰게
합니다. 이 상태는 npm 패키지에 들어가지 않습니다. `uninstall`은 LitClaude가 관리하는 항목만 지우고,
누가 손댄 설치는 건드리지 않습니다. Claude Code 마켓플레이스로 추가한 플러그인에는 상태 줄이 없고,
업데이트와 제거는 `/plugin` 메뉴에서 합니다.

## 더 보기

- [전체 안내와 스킬 갤러리 (GitHub)](https://github.com/wjgoarxiv/litclaude/blob/main/README_ko-KR.md)
- [개인정보와 네트워크 동작](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/privacy.md)
- [이전과 소유권 충돌](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/migration.md)
- [변경 이력](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/CHANGELOG.md)
- [MIT 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/LICENSE)
