import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { containsSecret, SECRET_SHAPE_PATTERNS } from "../plugins/litclaude/lib/secret-shapes.mjs";

describe("shared secret shapes", () => {
  it("recognizes the credential forms the knowledge runtime already refuses", () => {
    for (const sample of [
      "-----BEGIN RSA PRIVATE KEY-----",
      "ghp_abcdefghijklmnopqrstuvwxyz0123",
      "sk-abcdefghijklmnopqrstuvwxyz01",
      "AKIAIOSFODNN7EXAMPLE",
      "xoxb-1234567890-abcdefghij",
      "AIzaSyA1234567890abcdefghijklmnopqrs",
      "glpat-abcdefghijkl",
      "eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM",
      "Authorization: Bearer abcdefghijklmnop",
      "api_key = hunter2hunter2",
      "DATABASE_TOKEN: s3cr3tvalue123",
    ]) {
      assert.equal(containsSecret(sample), true, `must flag: ${sample.slice(0, 24)}`);
    }
  });

  it("recognizes ED25519 private keys, app tokens, and webhook secrets", () => {
    for (const sample of [
      "-----BEGIN ED25519 PRIVATE KEY----- synthetic",
      `xapp-${"A".repeat(20)}`,
      `whsec_${"W".repeat(24)}`,
    ]) {
      assert.equal(containsSecret(sample), true, `must flag: ${sample.slice(0, 24)}`);
    }
  });

  it("recognizes credential-bearing authorization headers without flagging bare Token prose", () => {
    for (const sample of [
      "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      "Bearer abcdefghijklmnop",
      "Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      "Authorization: Bearer abcdefghijklmnop",
      "Authorization: Digest credentials=secret",
      "Proxy-Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      "Proxy-Authorization: Bearer abcdefghijklmnop",
      "Proxy-Authorization: Digest credentials=secret",
      "Proxy-Authorization: Custom credentials=secret",
    ]) {
      assert.equal(containsSecret(sample), true, `must flag: ${sample}`);
    }
    assert.equal(containsSecret("Token ordinary-value"), false);
  });

  it("leaves ordinary prose and short identifiers alone", () => {
    for (const sample of [
      "the user asked for a shorter summary",
      "rename the token parser to lexer",
      "sk-",
      "we discussed api keys in the abstract",
      "PRIVATE KEY handling is documented in the runbook",
    ]) {
      assert.equal(containsSecret(sample), false, `must not flag: ${sample}`);
    }
  });

  it("leaves malformed and near-miss credential forms alone", () => {
    for (const sample of [
      "-----BEGIN ED25519 KEY----- synthetic",
      "-----BEGIN ED25519 PRIVATE KEY--- synthetic",
      `xapp-${"A".repeat(19)}`,
      `whsec_${"W".repeat(23)}`,
      "ordinary prose about an app integration and webhook secret",
      `notxapp-${"A".repeat(20)}`,
      `notwhsec_${"W".repeat(24)}`,
    ]) {
      assert.equal(containsSecret(sample), false, `must not flag: ${sample.slice(0, 32)}`);
    }
  });

  it("recognizes short values only when an explicit secret key assigns them", () => {
    for (const sample of [
      "password=x",
      "passwd: 7",
      "secret=short",
      "token: abc",
      "api_key=z",
      "ACCESS_TOKEN=q",
      "DATABASE_TOKEN: 1",
    ]) {
      assert.equal(containsSecret(sample), true, `must flag short assigned secret: ${sample}`);
    }
    for (const sample of [
      "key=value",
      "value=short",
      "the token parser accepts short values",
      "Token ordinary-value",
      "password handling is documented",
    ]) {
      assert.equal(containsSecret(sample), false, `must keep ordinary short prose: ${sample}`);
    }
  });

  it("checks raw text and text after safe control or format normalization", () => {
    for (const sample of [
      `ghp_\u200b${"A".repeat(24)}`,
      `sk_\u001b[31mlive_${"B".repeat(24)}\u001b[0m`,
      "//alice:se\u200bcret@example.invalid/path",
    ]) {
      assert.equal(containsSecret(sample), true, `must flag normalized shape: ${sample.slice(0, 12)}`);
    }
  });

  it("recognizes Bearer credentials when a separator uses a format or control character", () => {
    for (const [label, sample] of [
      ["format separator", `Bearer\u200b${"C".repeat(24)}`],
      ["control separator", `Bearer\u0000${"D".repeat(24)}`],
    ]) {
      assert.equal(containsSecret(sample), true, `must flag ${label}`);
    }
  });

  it("recognizes secrets hidden by a C1 CSI sequence", () => {
    assert.equal(containsSecret(`sk_\u009b31mlive_${"E".repeat(24)}`), true);
  });

  it("recognizes complete C1 OSC U+009D forms", () => {
    for (const [label, sample] of [
      ["BEL", `sk_\u009d8;;\u0007live_${"F".repeat(24)}`],
      ["ESC ST", `sk_\u009d8;;\u001b\\live_${"G".repeat(24)}`],
      ["C1 ST", `sk_\u009d8;;\u009clive_${"H".repeat(24)}`],
    ]) {
      assert.equal(containsSecret(sample), true, `must flag complete C1 OSC ${label}`);
    }
  });

  it("fails closed on unsupported or incomplete ANSI residue", () => {
    for (const [label, sample] of [
      ["unsupported ESC", `sk_\u001bXlive_${"I".repeat(24)}`],
      ["incomplete ESC CSI", `sk_\u001b[31mlive_${"J".repeat(24)}`],
      ["incomplete C1 CSI", `sk_\u009b31mlive_${"K".repeat(24)}`],
      ["incomplete ESC OSC", `sk_\u001b]8;;live_${"L".repeat(24)}`],
      ["incomplete C1 OSC", `sk_\u009d8;;live_${"M".repeat(24)}`],
    ]) {
      assert.equal(containsSecret(sample), true, `must fail closed for ${label}`);
    }
  });

  it("fails closed for every raw ESC and C1 control character", () => {
    for (const codePoint of [0x1b, ...Array.from({ length: 0x20 }, (_, index) => 0x80 + index)]) {
      const control = String.fromCodePoint(codePoint);
      assert.equal(containsSecret(`ordinary${control}text`), true, `must fail closed for U+${codePoint.toString(16).padStart(4, "0")}`);
    }
  });

  it("keeps non-ANSI raw, stripped, and spaced secret detection intact", () => {
    assert.equal(containsSecret(`ghp_${"A".repeat(24)}`), true, "raw detection must remain active");
    assert.equal(containsSecret(`ghp_\u200b${"B".repeat(24)}`), true, "stripped detection must remain active");
    assert.equal(containsSecret(`Bearer\u0000${"C".repeat(24)}`), true, "spaced detection must remain active");
  });

  it("accepts ordinary ANSI-free text after ANSI hardening", () => {
    assert.equal(containsSecret("ordinary ANSI-free text"), false);
  });

  it("fails closed before triple scanning an oversized raw input", () => {
    const hostile = "x".repeat(65_537);
    const startedAt = process.hrtime.bigint();
    assert.equal(containsSecret("x".repeat(65_536)), false);
    assert.equal(containsSecret(hostile), true);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    assert.ok(elapsedMs < 1_000, `oversized input took ${elapsedMs}ms`);
    assert.equal(containsSecret("x".repeat(1_000)), false);
  });

  it("never throws on hostile or non-string input", () => {
    for (const sample of [undefined, null, 42, {}, [], " ￿", "a".repeat(50_000)]) {
      assert.doesNotThrow(() => containsSecret(sample));
    }
  });

  it("exposes a frozen pattern set so a consumer cannot weaken it", () => {
    assert.ok(Object.isFrozen(SECRET_SHAPE_PATTERNS));
    assert.ok(SECRET_SHAPE_PATTERNS.length >= 12);
  });
});
