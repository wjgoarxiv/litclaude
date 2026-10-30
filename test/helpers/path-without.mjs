// A PATH with some programs taken out. On Linux CI ffmpeg is an apt package in /usr/bin, beside
// `which`, `sh` and Chrome, so dropping the directory is not an option: each directory that holds a
// hidden program is replaced by a shadow folder of links to everything else in it.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export const pathWithout = (dirs, hidden, scratch = mkdtempSync(join(tmpdir(), "litclaude-path-without-"))) =>
  dirs.map((dir, index) => {
    if (!hidden.some((name) => existsSync(join(dir, name)))) return dir;
    const shadow = join(scratch, String(index));
    mkdirSync(shadow, { recursive: true });
    for (const name of readdirSync(dir)) if (!hidden.includes(name)) symlinkSync(join(dir, name), join(shadow, name));
    return shadow;
  }).join(delimiter);
