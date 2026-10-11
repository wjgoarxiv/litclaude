// Draws composed rows (frame.mjs) with a surface's element table: one row Box of Text spans per
// line, inside a round-bordered card when the frame asks for one. It calls the element constructors
// directly, so the band's surface module, the mod's static fallback and the tests share it.

const textProps = (part) => {
  const props = { children: part.text, wrap: "truncate-end" };
  if (part.fg) props.color = part.fg;
  if (part.bg) props.backgroundColor = part.bg;
  if (part.bold) props.bold = true;
  return props;
};

export const renderRows = ({ Box, Text }, rows) =>
  rows.map((row) => {
    const parts = row.filter(({ text }) => text.length > 0);
    return Box({ flexDirection: "row", children: parts.length ? parts.map((part) => Text(textProps(part))) : [Text({ children: " " })] });
  });

export const renderBand = (elements, frame) => {
  const children = renderRows(elements, frame.rows);
  return frame.mode === "card"
    ? elements.Box({ flexDirection: "column", borderStyle: "round", borderColor: frame.border, paddingX: 1, children })
    : elements.Box({ flexDirection: "column", children });
};
