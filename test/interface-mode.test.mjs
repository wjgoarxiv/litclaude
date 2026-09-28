import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { hasInterfaceModeWord, interfaceMode } from "../plugins/litclaude/lib/interface-mode.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));
// The hook lower-cases, drops code and turns `-`/`_` into spaces before any route test.
const normalize = (text) => text.toLowerCase().replace(/[_-]+/gu, " ");
const context = (prompt, cwd = root) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd, prompt, session_id: "interface-mode-test" }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const routedMode = (prompt) => {
  const text = context(prompt);
  if (!/Skill\(frontend-ui-ux\)/u.test(text)) return null;
  return /Interface mode: (\w+)/u.exec(text)?.[1] ?? "build";
};

// The family spec's MD-002..MD-005 examples, with task-pack subject nouns swapped for neutral ones.
const EXAMPLES = {
  build: [
    "Build a settings screen with three tabs and a save button.",
    "Create a login form with email and password fields, plus inline validation.",
    "Implement a notification center that lists unread and read items separately.",
    "Add a product comparison table to the pricing page.",
    "새 프로필 편집 화면을 만들어줘, 아바타 업로드 포함해서.",
    "검색 결과 페이지를 구현해줘, 필터 사이드바 넣어서.",
    "온보딩 3단계 화면을 새로 짜줘.",
    "장바구니 화면에 수량 조절 버튼을 추가해줘.",
    "Redesign the settings screen with a completely new layout.",
    "Add a brand-new export button to the settings screen.",
    "Audit and then fix everything you find on the settings screen.",
    "이 화면 점검하고 바로 고쳐줘.",
    "버튼에 모션 다듬어줘, 인터랙션 전체를 다시 짜줘.",
    "Build a brand-new empty state design from scratch.",
    "이 화면 새로 만들어줘, 에러 상태 포함해서.",
  ],
  polish: [
    "Polish the existing settings screen, same layout, just clean up the spacing and contrast.",
    "Tighten up the spacing and type on the reports header, don't change what's there.",
    "This card grid looks a little rough, polish the shadows and radii without redesigning it.",
    "Clean up the styling on the login form; keep every field where it is.",
    "이 화면 그대로 두고 여백이랑 색만 다듬어줘.",
    "카드 레이아웃은 안 바꾸고 그림자랑 모서리만 다듬어줘.",
    "버튼 스타일만 다듬어줘, 구조는 손대지 말고.",
    "기존 프로필 화면 폰트랑 간격 좀 다듬어줘.",
    "Just polish the spacing on the existing settings screen, don't restructure it.",
    "버튼에 은은한 모션 좀 추가해줘, 화면 구조는 그대로 두고.",
    "Polish the reports page, it looks a bit rough.",
    "Just polish the empty state's spacing, don't stress-test anything else.",
  ],
  audit: [
    "Audit the checkout flow and give me a findings table, don't change any code.",
    "Review this reports page read-only, I just want to know what's wrong.",
    "Just check the settings screen, don't touch it.",
    "Run an audit on the product page before we decide what to fix.",
    "이 화면 점검만 해줘, 코드는 건드리지 말고.",
    "체크아웃 페이지 점검해줘, 수정은 하지 말고 목록만 줘.",
    "이 인터페이스 검토만 해줘, 고치지는 말고.",
    "통계 화면 점검 리포트만 뽑아줘.",
    "Just tell me what's wrong with the settings screen, don't touch anything.",
    "Audit the empty and error states, don't fix them.",
  ],
  harden: [
    "Harden the settings screen against empty data and a very long display name.",
    "Stress-test the checkout form with a slow network and validation errors.",
    "Make the reports page hold up under ten times the normal number of rows.",
    "Make the profile screen robust to a squeezed sidebar and a narrow 320px width.",
    "이 화면 튼튼하게 만들어줘, 빈 데이터랑 에러 상태도 확인해서.",
    "체크아웃 폼 견고하게 만들어줘, 느린 네트워크에서도 버티게.",
    "통계 화면이 데이터 10배 많을 때도 안 깨지게 튼튼하게 해줘.",
    "이 카드 목록 좁은 화면에서도 안 깨지게 튼튼하게 만들어줘.",
    "Check whether the settings screen holds up with a very long user name.",
    "Make the profile screen hold up under a very long display name and a slow network.",
  ],
};

describe("interface modes: wording", () => {
  for (const [mode, sentences] of Object.entries(EXAMPLES)) {
    it(`classifies the ${mode} examples as ${mode}`, () => {
      for (const sentence of sentences) assert.equal(interfaceMode(normalize(sentence)), mode, sentence);
    });
  }

  it("keeps build as the default when no mode word is present", () => {
    for (const sentence of ["design a new settings page UI", "새 설정 화면 만들어줘"]) {
      assert.equal(hasInterfaceModeWord(normalize(sentence)), false, sentence);
      assert.equal(interfaceMode(normalize(sentence)), "build", sentence);
    }
  });
});

describe("interface modes: routing through the hook", () => {
  it("routes mode wording on an interface surface to frontend-ui-ux with that mode", () => {
    for (const [prompt, mode] of [
      ["Harden the settings screen against empty data and a very long display name.", "harden"],
      ["이 화면 튼튼하게 만들어줘, 빈 데이터랑 에러 상태도 확인해서.", "harden"],
      ["이 화면 그대로 두고 여백이랑 색만 다듬어줘.", "polish"],
      ["Clean up the styling on the login form; keep every field where it is.", "polish"],
      ["이 화면 점검만 해줘, 코드는 건드리지 말고.", "audit"],
      ["Run an audit on the product page before we decide what to fix.", "audit"],
      ["design a new settings page UI", "build"],
      ["이 화면 점검하고 바로 고쳐줘.", "build"],
    ]) {
      assert.equal(routedMode(prompt), mode, prompt);
    }
  });

  it("names a non-default mode and where its contract lives, and adds nothing for build", () => {
    const text = context("이 화면 점검만 해줘, 코드는 건드리지 말고.");
    assert.match(text, /Interface mode: audit \(references\/craft-floor\.md section 3\)\./u);
    assert.ok(Buffer.byteLength(text, "utf8") <= 4096);
    assert.doesNotMatch(context("design a new settings page UI"), /Interface mode/u);
  });

  it("keeps an oversized project rule represented inside the 4 KiB context for every mode", () => {
    for (const prompt of ["Harden the settings screen against empty data.", "이 화면 점검만 해줘, 코드는 건드리지 말고.", "이 화면 여백 다듬어줘."]) {
      const temp = mkdtempSync(join(tmpdir(), "litclaude-interface-mode-rules-"));
      try {
        mkdirSync(join(temp, ".claude", "rules"), { recursive: true });
        writeFileSync(join(temp, "package.json"), "{}\n");
        writeFileSync(join(temp, ".claude", "rules", "oversized.md"), `---\nalwaysApply: true\n---\nOVERSIZED_MODE_RULE\n${"규칙가나다라마바사".repeat(2_000)}\n`);
        const text = context(prompt, temp);
        assert.match(text, /OVERSIZED_MODE_RULE/u, prompt);
        assert.ok(Buffer.byteLength(text, "utf8") <= 4096, prompt);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    }
  });

  // MD-006: video, 영상, 모션 and 발표 never widen the route; 다듬어 on prose and 점검 on
  // infrastructure never reach the interface skill.
  it("keeps prose, documents, infrastructure, video, motion and slides off the interface route", () => {
    for (const prompt of [
      "이 소개 문단 다듬어줘, 문장이 좀 어색해.",
      "이 보고서 초안 좀 다듬어줘.",
      "이 문단 다듬어줘, 어색한 데 있으면.",
      "서버 상태 점검 좀 해줘.",
      "배포 파이프라인 점검해줘.",
      "Check the API's uptime, not the UI.",
      "Make the server hold up under load.",
      "Cut this product demo video down to ninety seconds.",
      "이 인트로 영상에 자막 넣어줘.",
      "이 온보딩 영상 좀 다듬어줘, 컷 편집 위주로.",
      "이 온보딩 영상 안 끊기게 튼튼하게 인코딩해줘.",
      "모션이 저사양 기기에서도 안 끊기게 최적화해줘.",
      "발표 슬라이드 디자인 다듬어줘.",
      "발표 자료 점검해줘.",
      "발표 자료가 프로젝터에서도 안 깨지게 확인해줘.",
      "polish the release notes wording",
      "harden the database backup script",
    ]) {
      assert.equal(routedMode(prompt), null, prompt);
    }
  });
});
