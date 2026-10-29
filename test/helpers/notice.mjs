// The notice line every SKILL.md and agent file ends with (copyright, licence, official repo, fingerprint; guarded by
// test/notice-line.test.mjs). The prompt hook inlines a skill without it, and byte budgets measure prose without it.
export const NOTICE_LINE = /\n*<!-- LitClaude © \d{4} wjgoarxiv · MIT · github\.com\/wjgoarxiv\/litclaude · fp:[0-9a-f]{12} -->\n?$/u;

/** The text with its closing notice line removed (and the trailing newline the file ends with). */
export const withoutNotice = (text) => text.replace(NOTICE_LINE, "");
