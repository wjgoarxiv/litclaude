import { appendFileSync, closeSync, fsyncSync, openSync } from "node:fs";
import { dirname } from "node:path";

import { requireStateDir, STATE_APPEND_FLAG } from "../project-state-root.mjs";

export const appendLitgoalLedger = (path, entry) => {
  requireStateDir(dirname(path));
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  appendFileSync(path, `${JSON.stringify(record)}\n`, { flag: STATE_APPEND_FLAG });
  // Flush the appended record to disk for durability.
  const fd = openSync(path, "r+");
  fsyncSync(fd);
  closeSync(fd);
  return record;
};
