import { createHash } from "node:crypto";

const files = Object.freeze([
  Object.freeze({
    path: "_canonical-corpus/legal/frontend-ATTRIBUTION.md",
    sourcePath: "frontend/ATTRIBUTION.md",
    size: 12075,
    sha256: "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92",
  }),
  Object.freeze({
    path: "_canonical-corpus/legal/frontend-LICENSE-Apache-2.0.txt",
    sourcePath: "frontend/LICENSE-Apache-2.0.txt",
    size: 11296,
    sha256: "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da",
  }),
  Object.freeze({
    path: "_canonical-corpus/legal/root-LICENSE",
    sourcePath: "LICENSE",
    size: 1068,
    sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1",
  }),
]);

export const CANONICAL_FRONTEND_LEGAL_COMMITMENT = Object.freeze({
  fileCount: 3,
  byteCount: 24439,
  treeSha256: "2b7174f0662a5e41259b922fd1d94c24670df66894c7b9f81c9595ebd35fbc52",
  files,
});

export function canonicalFrontendLegalTreeSha256(entries) {
  const rows = [...entries]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(({ path, sourcePath, size, sha256 }) => `${JSON.stringify([path, sourcePath, size, sha256])}\n`)
    .join("");
  return createHash("sha256").update(rows).digest("hex");
}
