// Claude Code hands a mod a global `h`, the JSX factory: a string tag draws the element of that name
// from the surface's element table. This shim resolves it against the table a test's fake
// `$.ui.resolve` hands out, so `h("Client", props)` in the mod reaches the test's Client.
export const installModH = (table) => {
  globalThis.h = (tag, props, ...children) =>
    typeof tag === "function" ? tag({ ...props, children }) : table()[tag]?.(props ?? {});
};
