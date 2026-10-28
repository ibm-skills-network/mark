import type { Part } from "../contracts";
import {
  abridgeText,
  estimateTextTokens,
  NOTEBOOK_MAX_IMAGE_OUTPUTS,
  NOTEBOOK_OUTPUT_HEAD_LINES,
  NOTEBOOK_OUTPUT_MAX_CHARS,
  NOTEBOOK_OUTPUT_TAIL_LINES,
} from "../limits";

/**
 * Notebook-aware materialization. Every cell's source is kept; when the
 * notebook is over the cap, outputs shrink first: long text outputs are cut
 * to their first and last lines, then whole outputs are dropped largest
 * first. Only if the sources alone are over the cap is the text abridged.
 * Image outputs go to the model as image parts, up to a cap.
 */

interface RawOutput {
  output_type?: string;
  text?: unknown;
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: unknown;
}

interface RawCell {
  cell_type?: string;
  source?: unknown;
  outputs?: RawOutput[];
}

interface TextOutput {
  text: string;
  shortened?: string;
  dropped: boolean;
}

interface Cell {
  type: string;
  source: string;
  /** Text outputs and fixed notes (image references), in order. */
  outputs: Array<TextOutput | { note: string }>;
}

const NATIVE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function joinSource(source: unknown): string {
  if (Array.isArray(source)) return source.map(String).join("");
  return typeof source === "string" ? source : "";
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[\d;]*[A-Za-z]/g, "");
}

function lineCount(text: string): number {
  return text.split("\n").length;
}

function shorten(text: string): string | undefined {
  let result = text;
  const lines = text.split("\n");
  const keep = NOTEBOOK_OUTPUT_HEAD_LINES + NOTEBOOK_OUTPUT_TAIL_LINES;
  if (lines.length > keep) {
    const omitted = lines.length - keep;
    result = [
      ...lines.slice(0, NOTEBOOK_OUTPUT_HEAD_LINES),
      `[... ${omitted} output lines omitted ...]`,
      ...lines.slice(-NOTEBOOK_OUTPUT_TAIL_LINES),
    ].join("\n");
  }
  if (result.length > NOTEBOOK_OUTPUT_MAX_CHARS) {
    const head = Math.floor(NOTEBOOK_OUTPUT_MAX_CHARS * 0.75);
    const tail = NOTEBOOK_OUTPUT_MAX_CHARS - head;
    const omitted = result.length - head - tail;
    result = `${result.slice(0, head)}\n[... ${omitted} output characters omitted ...]\n${result.slice(-tail)}`;
  }
  return result === text ? undefined : result;
}

function render(cells: Cell[]): string {
  return cells
    .map((cell, index) => {
      const lines = [`--- cell ${index + 1} [${cell.type}] ---`, cell.source];
      if (cell.outputs.length > 0) {
        lines.push("--- output ---");
        for (const output of cell.outputs) {
          if ("note" in output) {
            lines.push(output.note);
          } else if (output.dropped) {
            lines.push(
              `[output omitted: ${lineCount(output.text)} lines, about ${estimateTextTokens(output.text)} tokens]`,
            );
          } else {
            lines.push(output.shortened ?? output.text);
          }
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export interface NotebookParts {
  text: string;
  images: Part[];
}

export function notebookToParts(
  name: string,
  json: string,
  maxTokens: number,
  options: { maxImages?: number } = {},
): NotebookParts {
  const maxImages = options.maxImages ?? NOTEBOOK_MAX_IMAGE_OUTPUTS;
  const parsed = JSON.parse(json) as { cells?: RawCell[] };
  const rawCells = Array.isArray(parsed.cells) ? parsed.cells : [];
  if (rawCells.length === 0) {
    return { text: "(notebook has no cells)", images: [] };
  }
  const images: Part[] = [];
  const cells: Cell[] = rawCells.map((raw, cellIndex) => {
    const outputs: Cell["outputs"] = [];
    const addText = (text: string) => {
      if (text.length > 0) outputs.push({ text, dropped: false });
    };
    for (const output of Array.isArray(raw.outputs) ? raw.outputs : []) {
      if (output.output_type === "stream") {
        addText(stripAnsi(joinSource(output.text)));
      } else if (output.output_type === "error") {
        const traceback = Array.isArray(output.traceback)
          ? output.traceback.map(String).join("\n")
          : "";
        addText(
          stripAnsi(
            `${output.ename ?? "Error"}: ${output.evalue ?? ""}\n${traceback}`,
          ),
        );
      } else if (output.data) {
        const data = output.data;
        const imageType = Object.keys(data).find((type) =>
          type.startsWith("image/"),
        );
        if (imageType) {
          const base64 = joinSource(data[imageType]).replaceAll(/\s+/g, "");
          if (!NATIVE_IMAGE_TYPES.has(imageType)) {
            outputs.push({
              note: `[image output (${imageType}) not included]`,
            });
          } else if (images.length >= maxImages) {
            outputs.push({
              note: `[image output (${imageType}) not included: over the ${maxImages}-image cap]`,
            });
          } else {
            const partName = `${name} › output image ${images.length + 1} (cell ${cellIndex + 1})`;
            images.push({
              name: partName,
              kind: "image",
              mimeType: imageType,
              base64,
            });
            outputs.push({ note: `[image output sent as part "${partName}"]` });
          }
        } else if (data["text/plain"] !== undefined) {
          addText(joinSource(data["text/plain"]));
        } else if (data["text/markdown"] !== undefined) {
          addText(joinSource(data["text/markdown"]));
        }
      }
    }
    return {
      type: raw.cell_type ?? "unknown",
      source: joinSource(raw.source),
      outputs,
    };
  });

  const full = render(cells);
  if (estimateTextTokens(full) <= maxTokens) return { text: full, images };

  const textOutputs = cells.flatMap((cell) =>
    cell.outputs.filter((output): output is TextOutput => !("note" in output)),
  );
  let shortenedCount = 0;
  for (const output of textOutputs) {
    output.shortened = shorten(output.text);
    if (output.shortened !== undefined) shortenedCount += 1;
  }
  const note = (dropped: number) =>
    `[notebook abridged: ${shortenedCount} long output(s) shortened, ${dropped} output(s) omitted; every cell's source is kept]`;
  const withNote = (dropped: number) => `${note(dropped)}\n${render(cells)}`;

  let text = withNote(0);
  let droppedCount = 0;
  const bySize = [...textOutputs].sort(
    (a, b) => (b.shortened ?? b.text).length - (a.shortened ?? a.text).length,
  );
  for (const output of bySize) {
    if (estimateTextTokens(text) <= maxTokens) break;
    output.dropped = true;
    droppedCount += 1;
    text = withNote(droppedCount);
  }
  if (estimateTextTokens(text) <= maxTokens) return { text, images };

  const sourcesOnly = render(cells);
  const header = `[notebook abridged: all ${droppedCount} output(s) omitted and the cell sources alone are over the cap]`;
  return {
    text: `${header}\n${abridgeText(sourcesOnly, maxTokens - estimateTextTokens(header) - 10)}`,
    images,
  };
}
