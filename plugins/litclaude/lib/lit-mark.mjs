// Ignition B: exact accepted quadrant rows and per-cell colors.
// test/fixtures/litmark/ignition.json pins the selected geometry independently.

export const standard = Object.freeze([
  "          ▄▖  ▄█▄     ",
  "▗▄▄▖    ▄██▌  ▜█▛     ",
  "▐██▌  ▄████████████▜▛ ",
  "▐██▌ ▐█▀▀▀▀▀▀▀▀▀▀▀▀▘  ",
  "▐██▌   ▄█▌█████████▌  ",
  "▐██▌ ▄██▛▘  ▗▄▄  ▗    ",
  "▐██▌▐█▛▘    ▐██  ▝▀   ",
  "▐██▌▝       ▐██       ",
  "▐██████▘    ▐██       ",
  "▝▀▀▀▀▀      ▝▀▀       "
]);

export const banner = Object.freeze([
  "                             ▄▄▄▄           ",
  "                   ▗███▌   ▗██████▖         ",
  " ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘         ",
  " ▐█████        ▗▟██████▌    ▝▀▜█▀▘          ",
  " ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ",
  " ▐█████    ▗▟█████████████████████████ ▐█▀  ",
  " ▐█████    ████████████████████████████▀    ",
  " ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖     ",
  " ▐█████    ▀    ▄██ ████▌█████████████▌     ",
  " ▐█████       ▄████ ████▌█████████████▌     ",
  " ▐█████     ▄█████▛                         ",
  " ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖       ",
  " ▐█████ ▐█████▀          █████     ▐▛▀      ",
  " ▐█████ ▐███▀            █████              ",
  " ▐█████ ▐█▀              █████              ",
  " ▐█████ ▝                █████              ",
  " ▐█████▄▄▄▄▄▄▄▖          █████              ",
  " ▐███████████▛           █████              ",
  " ▐██████████▀            █████              ",
  "                                            "
]);

export const micro = Object.freeze([
  "▗▖  ▄▄ █▌       ",
  "▐▌▗█▀▀▀▀▀▀▘     ",
  "▐▌ ▄▌▀▝▀▀▘      ",
  "▐▌▛▘  ▐▌        ",
  "▝▀▀▘  ▝▘        "
]);

// O: ignition orange; L: signal lime; I: terminal ivory; space: no paint.
const cellColors = Object.freeze({
  standard: Object.freeze([
    "          II  LLL     ",
    "OOOO    IIII  LLL     ",
    "OOOO  IIIIOOOOOOOOOOO ",
    "OOOO IIIOOOOOOOOOOOO  ",
    "OOOO   IIILLLIIIIIII  ",
    "OOOO IIIII  III  I    ",
    "OOOOIIII    III  II   ",
    "OOOOI       III       ",
    "OOOOOOOO    III       ",
    "OOOOOO      III       "
  ]),
  banner: Object.freeze([
    "                             LLLL           ",
    "                   IIIII   LLLLLLLL         ",
    " OOOOOO          IIIIIII   LLLLLLLL         ",
    " OOOOOO        IIIIIIIII    LLLLLL          ",
    " OOOOOO      IIIIIIIIIOOOOOOOOOOOOOOOOOOOO  ",
    " OOOOOO    IIIIIIIIOOOOOOOOOOOOOOOOOOO OOO  ",
    " OOOOOO    IIIIIIOOOOOOOOOOOOOOOOOOOOOOO    ",
    " OOOOOO    IIII   I LLLLLIIIIIIIIIIIIII     ",
    " OOOOOO    I    III LLLLLIIIIIIIIIIIIII     ",
    " OOOOOO       IIIII LLLLLIIIIIIIIIIIIII     ",
    " OOOOOO     IIIIIII                         ",
    " OOOOOO  IIIIIIIII       IIIII     II       ",
    " OOOOOO IIIIIII          IIIII     III      ",
    " OOOOOO IIIII            IIIII              ",
    " OOOOOO III              IIIII              ",
    " OOOOOO I                IIIII              ",
    " OOOOOOOOOOOOOO          IIIII              ",
    " OOOOOOOOOOOOO           IIIII              ",
    " OOOOOOOOOOOO            IIIII              ",
    "                                            "
  ]),
  micro: Object.freeze([
    "OO  II LL       ",
    "OOIIIOOOOOO     ",
    "OO IILIIII      ",
    "OOII  II        ",
    "OOOO  II        "
  ])
});

const palettes = Object.freeze({
  truecolor: Object.freeze({ O: "38;2;255;99;55", L: "38;2;215;247;91", I: "38;2;242;239;223" }),
  "256": Object.freeze({ O: "38;5;203", L: "38;5;191", I: "38;5;230" }),
});
const variants = Object.freeze({ standard, banner, micro });

// Keep the native product column eight cells beyond the canonical envelope.
export function lockup(productName, rows = standard) {
  if (typeof productName !== "string" || !/^[a-z][a-z0-9 .-]*$/u.test(productName)) {
    throw new TypeError("productName must be a plain product label");
  }
  const labels = [productName, "──────────────", "hermes · codex", "opencode · grok"];
  const offset = Math.floor(rows.length / 2);
  const column = Math.max(...rows.map((row) => row.length)) + 6;
  return rows.map((row, index) => row.padEnd(column) + (labels[index - offset] ? `  ${labels[index - offset]}` : ""));
}

export function colorize(rows, { mode = "none" } = {}) {
  if (mode === "none") return rows.slice();
  if (!["truecolor", "256"].includes(mode)) throw new RangeError("unknown LIT color mode");
  // The CLI trims lockup whitespace before rendering; recognize those rows too.
  const variant = Object.keys(variants).find((name) => variants[name].length === rows.length
    && variants[name].every((row, index) => rows[index].startsWith(row) || rows[index].trimEnd() === row.trimEnd()));
  return rows.map((row, index) => [...row].map((glyph, column) => {
    const color = variant ? cellColors[variant][index][column]
      : /[█▀▄▌▐▖▗▘▝▙▛▜▟▚▞]/u.test(glyph) ? "I" : undefined;
    return palettes[mode][color] ? `\x1b[${palettes[mode][color]}m${glyph}\x1b[0m` : glyph;
  }).join(""));
}

export function colorMode({ env = process.env, isTTY = process.stdout.isTTY, args = process.argv.slice(2) } = {}) {
  if (Object.hasOwn(env, "NO_COLOR") || Object.hasOwn(env, "CI") || !isTTY || args.some((arg) => /^--json(?:=|$)/u.test(arg))) return "none";
  return /truecolor|24bit/iu.test(env.COLORTERM ?? "") ? "truecolor" : "256";
}

export function supportsBlocks(env = process.env) {
  return env.TERM !== "dumb" && /utf-?8/iu.test(env.LC_ALL || env.LC_CTYPE || env.LANG || "");
}

export function terminalRows(rows, options = {}) {
  if (!supportsBlocks(options.env)) return ["LIT"];
  const detected = colorMode(options);
  return colorize(rows, { shadow: options.shadow, mode: detected === "none" ? "none" : options.mode ?? detected });
}
