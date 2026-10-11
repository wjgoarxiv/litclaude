# Jev 스킬 힌트 (선택)

[README](../README_ko-KR.md) · [안내서](./guide_ko-KR.md) · [English](./jev.md)

LitClaude에는 스킬이 35개 있고, TypeSafe가 호스팅하는 선택 모델 Jev에게 프롬프트에 맞는 스킬을
물어볼 수 있습니다. Jev가 스킬 하나를 고르면 `UserPromptSubmit` 훅이 그 이름을 담은 한 줄을
Claude가 참고하도록 덧붙입니다. 어디까지나 제안이어서, 스킬을 불러올지는 Claude가 정하고 이 한
줄로 권한이 생기거나 도구가 실행되는 일은 없습니다.

기본값은 꺼짐입니다. 써 보려면 Claude Code를 실행하는 환경에 두 변수를 모두 설정합니다.

```bash
export LITCLAUDE_JEV=1
export TYPESAFE_API_KEY=<본인의 TypeSafe 키>
```

켜면 프롬프트가 컴퓨터 밖으로 나갑니다. 정확히 무엇이 나가는지는 다음과 같습니다. 해당하는
프롬프트마다 2,000자로 자르고, 홈 경로와 이메일 주소, 토큰 모양의 문자열을 가린 뒤
TypeSafe(typesafe.ai)로 보냅니다. 나머지는 적힌 그대로 갑니다. 호스트 이름, 고객 이름,
`password=…` 꼴로 쓰지 않은 비밀번호도 마찬가지입니다. 슬래시 명령, `lit` 라우터가 이미 처리한
프롬프트, 스킬 이름을 직접 적은 프롬프트는 보내지 않고, 파일·도구 출력·대화 기록처럼 세션의
다른 내용도 컴퓨터 밖으로 나가지 않습니다.

켜기 전에 두 가지를 챙기세요. 키는 Claude Code를 실행하는 셸에 export되므로 에이전트의 도구도
읽을 수 있습니다. 이 기능 전용 키를 따로 만들고 사용 한도를 낮게 잡아 두세요. 또 요청마다
본인의 TypeSafe 계정에 비용이 청구되며, 입력 토큰 100만 개당 약 0.04달러입니다. 요청은 최대
1.5초만 기다리고, 실패하면 평소처럼 진행하면서 세션에서 처음 한 번만 짧게 알립니다.

켜졌는지 보려면 `litclaude doctor`를 실행하세요. `Jev skill hint: off`, `on`,
`flag on but TYPESAFE_API_KEY missing` 중 하나를 출력합니다. 끄려면 `LITCLAUDE_JEV`를 해제하거나
`1`이 아닌 값으로 바꿉니다. 세부 조정 변수와 로컬 디버그 기록은 `docs/hooks.md`에 있습니다.

## 화면에서 보이는 모습

Jev는 세 곳에 모습을 드러냅니다. HUD 상태 줄, 세션 첫 프롬프트에 나오는 한 줄,
`litclaude doctor`입니다. 아래 그림은 LitClaude의 실제 상태 줄과 프롬프트 훅을 작은 데모
프로젝트에서 자리표시용 키로 돌려 얻은 예시 출력입니다. 네트워크 호출은 저장소의 테스트용
대역으로 바꿔 두었으므로 TypeSafe로는 아무것도 나가지 않았습니다. 프롬프트와 스킬 이름은 예시입니다.
그림은 페이지 테마를 따라 바뀝니다. 밝은 터미널에서는 `Jev`라는 글자가 기본 색을 유지하고 기호만
색이 입혀집니다.

Jev가 꺼져 있으면 상태 줄에는 모델 이름만 보입니다. 두 변수를 모두 설정하기 전까지는 이 모습입니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-status-off-dark.webp" /><img src="./assets/jev/jev-status-off-light.webp" width="100%" alt="claude라는 제목의 터미널 창. 상태 줄: [불꽃 아이콘]LITCLAUDE vX.Y.Z] | O5.5 │ ctx [▊░░] 23%/200k │ 5h [░░] --% │ 1w [░░] --%. 둘째 줄: └─ Sketch a plan for moving our nightly jobs to a queue. 그 아래에 O5.5라고 적힌 확대 라벨." /></picture></p>

*LitClaude의 실제 상태 줄로 렌더링한 예시 출력입니다.*

Jev를 켜면 세션의 첫 프롬프트에 무지개색 한 줄이 나옵니다(`NO_COLOR`에서는 색 없는 글자). 이
세션에서 조건에 맞는 프롬프트가 TypeSafe로 나간다는 것을 알려 주는 줄입니다.

<p align="center"><img src="./assets/jev/jev-first-prompt-notice.webp" width="100%" alt="claude라는 제목의 터미널 창에 무지개색으로 표시된 한 줄: ✦ Jev skill hint ON ✦" /></p>

*LitClaude의 실제 프롬프트 훅으로 렌더링한 예시 출력입니다.*

그다음부터는 모델 이름 바로 옆에 `✦Jev`가 붙고, 터미널이 색을 지원하면 글자가 은은하게 반짝입니다.
Jev가 충분히 맞는 스킬을 찾지 못하면 이 표시가 유일한 변화이고, 그 턴은 평소처럼 진행됩니다. 상태 줄
그림 아래의 확대 라벨은 작은 화면에서도 모델 이름을 읽을 수 있게 해 줍니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-status-quiet-dark.webp" /><img src="./assets/jev/jev-status-quiet-light.webp" width="100%" alt="claude라는 제목의 터미널 창. 상태 줄: [불꽃 아이콘]LITCLAUDE vX.Y.Z] | O5.5 ✦Jev │ ctx [▊░░] 23%/200k │ 5h [░░] --% │ 1w [░░] --%. 둘째 줄: └─ Rename the config loader and update its imports. 그 아래에 O5.5 ✦Jev라고 적힌 확대 라벨." /></picture></p>

*LitClaude의 실제 상태 줄로 렌더링한 예시 출력입니다.*

Jev가 스킬을 고르면 그 턴 동안 화살표 뒤에 스킬 이름이 나오고, Claude는 그 스킬을 제안하는 한
줄을 받습니다. 스킬을 불러올지는 Claude가 정합니다. 여기 나온 이름은 예시입니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-status-hint-dark.webp" /><img src="./assets/jev/jev-status-hint-light.webp" width="100%" alt="claude라는 제목의 터미널 창. 상태 줄: [불꽃 아이콘]LITCLAUDE vX.Y.Z] | O5.5 ✦Jev → lit-plan │ ctx [▊░░] 23%/200k │ 5h [░░] --% │ 1w [░░] --%. 둘째 줄: └─ Sketch a plan for moving our nightly jobs to a queue. 그 아래에 O5.5 ✦Jev → lit-plan이라고 적힌 확대 라벨." /></picture></p>

*힌트가 나온 턴 뒤의 LitClaude 실제 상태 줄로 렌더링한 예시 출력입니다.*

플래그는 켜져 있는데 키가 비어 있으면 표시가 주황색으로 바뀌며 `⚠ key`가 뜨고, 조건에 맞는 첫
프롬프트에 짧은 안내가 한 번 나옵니다. TypeSafe로는 아무것도 나가지 않고, 프롬프트는 평소처럼 Claude에게
전달됩니다. 키를 설정하면 표시가 `✦Jev`로 돌아오고, 플래그를 해제하면 사라집니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-status-key-dark.webp" /><img src="./assets/jev/jev-status-key-light.webp" width="100%" alt="claude라는 제목의 터미널 창. 첫 줄: LitClaude skill hint unavailable (key-missing); continuing normally. 상태 줄: [불꽃 아이콘]LITCLAUDE vX.Y.Z] | O5.5 ✦Jev ⚠ key │ ctx [▊░░] 23%/200k │ 5h [░░] --% │ 1w [░░] --%. 둘째 줄: └─ Sketch a plan for moving our nightly jobs to a queue. 그 아래에 O5.5 ✦Jev ⚠ key라고 적힌 확대 라벨." /></picture></p>

*LitClaude의 실제 프롬프트 훅과 상태 줄로 렌더링한 예시 출력입니다.*
