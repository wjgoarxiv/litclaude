import { createHash } from "node:crypto";

export const CANONICAL_RUNTIME_COMMITMENTS = Object.freeze(new Map([
  ["autoresearch", Object.freeze({
    commit: "58a65afc174cd8c2fa162bb0d1953b0a88e5d419",
    root: "vendor/autoresearch",
    fileCount: 28,
    treeSha256: "194d6fff2cb728818da6dbdd980a8bd1bff8287113123c17ce69f39b0c1d59a2",
  })],
  ["autoconference", Object.freeze({
    commit: "58a65afc174cd8c2fa162bb0d1953b0a88e5d419",
    root: "vendor/autoconference",
    fileCount: 29,
    treeSha256: "73340b0a17eafaa0b10c0a41adb73937119781ec7c9062d68cb98d86034b719b",
  })],
  ["wikify", Object.freeze({
    commit: "dfe8f8bc372c3bc153dd57697f4a36f366a63e74",
    root: "vendor/llm-wikify",
    fileCount: 12,
    treeSha256: "560a06f32a7628e35ff4d76143361089afebf5260cd70415f1dbbe3de50d76bb",
  })],
]));

export const CANONICAL_RUNTIME_ADAPTER_COMMITMENTS = Object.freeze([
  Object.freeze({
    path: "skills/autoresearch/SKILL.md",
    size: 8153,
    executable: false,
    sha256: "be86f3e098fb74ac1ce99a4ece476837e31967b0e3b1886f5252164727ae87b4",
  }),
  Object.freeze({
    path: "skills/autoconference/SKILL.md",
    size: 8262,
    executable: false,
    sha256: "9e326405d23919a910ea53211c4cab0306d2d848654763a0975338b2de058774",
  }),
  Object.freeze({
    path: "skills/wikify/SKILL.md",
    size: 10224,
    executable: false,
    sha256: "1894ea8588072f6766f7c6752d714ff3dea23d040e169eb4484d7178dfb96d94",
  }),
  Object.freeze({
    path: "commands/autoresearch.md",
    size: 2667,
    executable: false,
    sha256: "9ec677084179c7e64ffaf3bb8a0b00b67a454d4c73599cd0656e113fd5afc59a",
  }),
  Object.freeze({
    path: "commands/autoconference.md",
    size: 2364,
    executable: false,
    sha256: "4a17f84e6e9bc967b74a3f53b9b37ec17ee470ec73ad63487ee85119f68654ba",
  }),
  Object.freeze({
    path: "commands/wikify.md",
    size: 3716,
    executable: false,
    sha256: "73ab75903e23af8534bf8df01c4930aa6284bae5ee778d86f7ac1e540f84b100",
  }),
]);

export function canonicalRuntimeTreeSha256(files) {
  const rows = [...files]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(({ path, size, mode, sha256 }) => `${JSON.stringify([path, size, sha256, (mode & 0o111) !== 0])}\n`)
    .join("");
  return createHash("sha256").update(rows).digest("hex");
}
