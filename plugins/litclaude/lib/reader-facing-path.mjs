import { extname } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".adoc", ".asciidoc", ".csv", ".htm", ".html", ".markdown", ".md", ".mdx", ".org", ".rst", ".svg", ".tex", ".tsv", ".txt", ".xml",
]);
export const DOCUMENT_EXTENSIONS = new Set([".docx", ".pptx", ".pdf"]);
const READER_FACING_NAMES = new Set(["CHANGELOG", "CONTRIBUTING", "LICENSE", "NOTICE", "README"]);

export const extensionOf = (path) => extname(path).toLowerCase();
export const readerFacing = (path) => TEXT_EXTENSIONS.has(extensionOf(path))
  || DOCUMENT_EXTENSIONS.has(extensionOf(path))
  || READER_FACING_NAMES.has(path.split(/[\\/]/u).at(-1).toUpperCase());
