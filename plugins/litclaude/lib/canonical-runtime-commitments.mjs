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
    size: 8055,
    executable: false,
    sha256: "2b69c53bade3851cfb9c770bce80afe5f9e75b9629719e9ba95a4b0045eaf5b3",
  }),
  Object.freeze({
    path: "skills/autoconference/SKILL.md",
    size: 8159,
    executable: false,
    sha256: "e034a0232d59bea9f9ed27bb8844a7ee039dd5c7d38aeaffaa32e7ee63daa5ad",
  }),
  Object.freeze({
    path: "skills/wikify/SKILL.md",
    size: 10111,
    executable: false,
    sha256: "0a0b4f881c107fdec9cf6d1740cfdc17cb913c5f8fa12cf5000997e06b5652e4",
  }),
  Object.freeze({
    path: "commands/autoresearch.md",
    size: 2399,
    executable: false,
    sha256: "e062cd04487bc5926ec0f1dd218c487d0d175f7a267b818632b419eae5bcb9cb",
  }),
  Object.freeze({
    path: "commands/autoconference.md",
    size: 2364,
    executable: false,
    sha256: "4a17f84e6e9bc967b74a3f53b9b37ec17ee470ec73ad63487ee85119f68654ba",
  }),
  Object.freeze({
    path: "commands/wikify.md",
    size: 3711,
    executable: false,
    sha256: "8a67b79ea9a1b2b36b8375fd67f82845658e76ab821f577508c850132e730a14",
  }),
]);

export function canonicalRuntimeTreeSha256(files) {
  const rows = [...files]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(({ path, size, mode, sha256 }) => `${JSON.stringify([path, size, sha256, (mode & 0o111) !== 0])}\n`)
    .join("");
  return createHash("sha256").update(rows).digest("hex");
}
