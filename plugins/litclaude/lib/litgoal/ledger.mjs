import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

export const appendLitgoalLedger = (path, entry) => {
  mkdirSync(dirname(path), { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  // Flush the appended record to disk for durability.
  const fd = openSync(path, "r");
  fsyncSync(fd);
  closeSync(fd);
  return record;
};
