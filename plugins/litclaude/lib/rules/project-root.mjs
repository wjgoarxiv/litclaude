import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { PROJECT_MARKERS } from "./constants.mjs";

/** Walk up from startDir until a directory holds a project marker. Null when none does. */
export const findProjectRoot = (startDir) => {
  if (typeof startDir !== "string" || startDir.length === 0) return null;
  let current = resolve(startDir);
  for (;;) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};
