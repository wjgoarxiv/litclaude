// Draws composed rows (frame.mjs) with a surface's element table: one row Box of Text spans per
// line. The LIT card draws its own border as text, so its title and figures sit in the edges. It
// calls the element constructors directly, so the band's surface module, the mod's static fallback
// and the tests share it.

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

export const renderBand = (elements, frame) => elements.Box({ flexDirection: "column", children: renderRows(elements, frame.rows) });
