import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

const MAX_TRANSCRIPT_BYTES = 256 * 1024;

const contextPressureMarkers = [
  "context compacted",
  "context_length_exceeded",
  "context_too_large",
  "context window",
  "skill descriptions were shortened",
  "input exceeds the context",
];

export const hasContextPressure = (text) => {
  if (typeof text !== "string") return false;
  const normalized = text.toLowerCase();
  return contextPressureMarkers.some((marker) => normalized.includes(marker));
};

export const transcriptHasContextPressure = (transcriptPath) => {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) return false;
  let fd;
  try {
    const pathStats = lstatSync(transcriptPath);
    if (!pathStats.isFile() || pathStats.isSymbolicLink() || pathStats.size > MAX_TRANSCRIPT_BYTES) return false;
    fd = openSync(transcriptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats = fstatSync(fd);
    if (!openedStats.isFile() || openedStats.size !== pathStats.size || openedStats.size > MAX_TRANSCRIPT_BYTES) return false;
    return hasContextPressure(readFileSync(fd, "utf8"));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};
