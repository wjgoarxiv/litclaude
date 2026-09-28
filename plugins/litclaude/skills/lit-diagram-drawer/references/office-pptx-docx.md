# PowerPoint and Word delivery

Design on the final page ratio, keep live labels, and reserve room for the document's own title and surrounding text.

## Canvas and safe margins

| Destination | Canvas ratio | Diagram inset |
|---|---:|---:|
| PowerPoint widescreen | 16:9, 1280 × 720 | 5% on each edge |
| PowerPoint standard | 4:3, 960 × 720 | 5% on each edge |
| Word inline | 16:10, 960 × 600 | 40px |
| Word landscape/wide | 16:9, 1200 × 675 | 4% on each edge |

Keep titles and key labels inside the inset. Do not place essential text flush to the crop edge. For dense content, create a second detail diagram rather than reducing type.

## Light and dark use

- Light is the default for Word, print, and shared slide decks.
- Dark is appropriate only when the whole presentation uses a dark canvas. Keep a dark slide background behind the diagram so a light rectangle does not appear as a pasted panel.
- Full-editorial is useful when the figure needs its own title and key. Do not repeat a caption already provided by Word or PowerPoint.
- Check the actual projection or page size. Laptop preview is not a substitute for the final slide scale.

## PNG

Use 3× PNG for raster delivery. For a 1280 × 720 source canvas, that produces a 3840 × 2160 image. Use 1× or 2× only when file size or destination constraints require it. Verify the background and transparent edges before placing the image.

## Office-safe SVG

Use SVG when users need crisp vector scaling. The Office-safe mode applies the conservative SVG rules in references/export.md and embeds the bundled font when possible. It strips unsupported filters, external references, CSS variables in presentation attributes, and remote resources. Keep colors as explicit hex values and opacity attributes.

The export check creates and normalizes a small PPTX fixture with the SVG relationship and transparent PNG fallback, then opens it in the available Office renderer when that check is supported. Inspect the rendered page; a ZIP entry alone proves packaging, not visual fidelity. If an Office installation does not render the embedded font or SVG, report the limitation and supply the 3× PNG.

## Word figures

- Keep a short figure title and description in nearby document text.
- Use a caption field outside the image when the document needs numbering or cross-references.
- Provide alt text matching the SVG title and description.
- Check the image at 100% and page width. Confirm the caption, labels, and margins survive a PDF export when PDF is part of delivery.

## Placement note

SVG and PNG exports contain the diagram itself. They do not include editor controls or a decorative web-page header. Place the result as a picture and keep the source HTML or SVG beside the document for later edits.
