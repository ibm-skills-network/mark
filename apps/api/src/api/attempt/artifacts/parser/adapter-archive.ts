import { extname } from "node:path";
import {
  AdapterLimits,
  ParserDocument,
  enforceDocumentLimits,
} from "./adapter-types";
import { readBoundedZip } from "./bounded-zip";

const textExtensions = new Set(
  "txt md markdown rst csv tsv json jsonl yaml yml toml ini cfg conf xml html htm css scss sql py js jsx ts tsx mjs cjs java c cpp cc h hpp cs go rs rb php sh bash swift kt scala r vue svelte tex log".split(
    " ",
  ),
);
const plainExtensions = new Set("txt md markdown rst csv tsv log".split(" "));

export async function extractArchive(
  bytes: Buffer,
  limits: AdapterLimits,
): Promise<ParserDocument> {
  if (bytes.length > limits.inputBytes) throw new Error("input_limit");
  const archive = await readBoundedZip(bytes, limits);
  const document: ParserDocument = {
    blocks: [],
    omissions: [],
    expandedBytes: archive.expandedBytes,
  };
  for (const entry of archive.entries) {
    const extension = extname(entry.path).slice(1).toLowerCase();
    const location = { archivePath: entry.path };
    if (!textExtensions.has(extension)) {
      document.omissions.push({
        code: "unsupported_feature",
        location,
        detail: "Archive member format is not extracted.",
      });
      continue;
    }
    let text: string;
    try {
      text = new TextDecoder("utf8", { fatal: true }).decode(entry.bytes);
    } catch {
      document.omissions.push({
        code: "unsupported_feature",
        location,
        detail: "Archive member encoding is not supported.",
      });
      continue;
    }
    if (text.includes("\u0000")) {
      document.omissions.push({
        code: "unsupported_feature",
        location,
        detail: "Archive member contains binary content.",
      });
      continue;
    }
    if (text.length > 0)
      document.blocks.push({
        kind: plainExtensions.has(extension) ? "text" : "code",
        text,
        location: {
          ...location,
          lineStart: 1,
          lineEnd: text.split("\n").length,
        },
      });
    enforceDocumentLimits(document, limits);
  }
  document.empty =
    document.blocks.length === 0 && document.omissions.length === 0;
  return enforceDocumentLimits(document, limits);
}
