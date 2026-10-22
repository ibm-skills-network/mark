import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  AdapterLimits,
  ParserDocument,
  enforceDocumentLimits,
  record,
  sourceText,
} from "./adapter-types";

/** Parses persisted notebook bytes only; never executes cells or calls a model. */
export async function extractNotebook(
  bytes: Buffer,
  limits: AdapterLimits,
): Promise<ParserDocument> {
  if (bytes.length > limits.inputBytes) throw new Error("input_limit");
  let notebook: Record<string, unknown>;
  try {
    notebook = record(
      JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
    );
  } catch {
    throw new Error("corrupt_input");
  }
  if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells))
    throw new Error("corrupt_input");
  if (notebook.cells.length > 1000) throw new Error("expansion_limit");
  const document: ParserDocument = {
    blocks: [],
    omissions: [],
    expandedBytes: 0,
    resources: [],
  };
  const resources = new Set<string>();
  const addText = (text: string, cell: number, code = false) => {
    document.expandedBytes += Buffer.byteLength(text);
    if (text.length > 0)
      document.blocks.push({
        kind: code ? "code" : "text",
        text,
        location: { notebookCell: cell },
      });
    enforceDocumentLimits(document, limits);
  };
  for (const [index, rawCell] of notebook.cells.entries()) {
    const cell = record(rawCell);
    if (!["code", "markdown", "raw"].includes(String(cell.cell_type)))
      throw new Error("corrupt_input");
    addText(sourceText(cell.source), index, cell.cell_type === "code");
    if (cell.attachments && Object.keys(record(cell.attachments)).length > 0)
      document.omissions.push({
        code: "missing_visual_evidence",
        location: { notebookCell: index },
        detail: "Notebook cell attachments are not extracted.",
      });
    if (cell.cell_type !== "code") continue;
    if (!Array.isArray(cell.outputs)) throw new Error("corrupt_input");
    if (cell.outputs.length > 1000) throw new Error("expansion_limit");
    for (const rawOutput of cell.outputs) {
      const output = record(rawOutput);
      if (output.output_type === "stream") {
        addText(sourceText(output.text), index);
        continue;
      }
      if (output.output_type === "error") {
        addText(sourceText(output.traceback), index);
        document.omissions.push({
          code: "parser_warning",
          location: { notebookCell: index },
          detail: "Notebook records an execution error.",
        });
        continue;
      }
      if (
        output.output_type !== "display_data" &&
        output.output_type !== "execute_result"
      )
        throw new Error("corrupt_input");
      const data = record(output.data);
      for (const [mime, value] of Object.entries(data)) {
        if (mime === "text/plain") {
          addText(sourceText(value), index);
          continue;
        }
        if (mime === "image/png" || mime === "image/jpeg") {
          const base64 = sourceText(value).replaceAll(/\s/g, "");
          if (
            base64.length === 0 ||
            base64.length % 4 !== 0 ||
            !/^[\d+/A-Za-z]*={0,2}$/.test(base64)
          )
            throw new Error("corrupt_input");
          const image = Buffer.from(base64, "base64");
          if (image.toString("base64") !== base64)
            throw new Error("corrupt_input");
          if (image.length > 1_500_000) throw new Error("expansion_limit");
          const validSignature =
            mime === "image/png"
              ? image
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : image[0] === 255 && image[1] === 216 && image[2] === 255;
          if (!validSignature) throw new Error("corrupt_input");
          const id = `image-${createHash("sha256").update(image).digest("hex")}`;
          if (!resources.has(id)) {
            if (resources.size >= 60) throw new Error("expansion_limit");
            const pixelLimit = Math.max(
              1,
              Math.floor((limits.expandedBytes - document.expandedBytes) / 4),
            );
            try {
              const metadata = await sharp(image, {
                limitInputPixels: pixelLimit,
                failOn: "warning",
              }).metadata();
              if (
                !metadata.width ||
                !metadata.height ||
                (metadata.pages ?? 1) > 1
              )
                throw new Error("corrupt_input");
              const decoded = await sharp(image, {
                limitInputPixels: pixelLimit,
                failOn: "warning",
              })
                .raw()
                .toBuffer();
              document.expandedBytes += decoded.length;
            } catch {
              throw new Error("corrupt_input");
            }
            resources.add(id);
            document.resources.push({ id, mediaType: mime, base64 });
            document.expandedBytes += image.length;
          }
          document.blocks.push({
            kind: "image",
            resourceRef: id,
            location: { notebookCell: index },
          });
        } else {
          document.omissions.push({
            code: "unsupported_feature",
            location: { notebookCell: index },
            detail: "Notebook output representation is not extracted.",
          });
        }
        enforceDocumentLimits(document, limits);
      }
    }
  }
  document.empty =
    document.blocks.length === 0 && document.omissions.length === 0;
  return enforceDocumentLimits(document, limits);
}
