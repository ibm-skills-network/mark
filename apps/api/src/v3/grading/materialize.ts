import * as mammoth from "mammoth";
import { Open as OpenZip } from "unzipper";
import * as XLSX from "xlsx";
import type { Part } from "./contracts";
import { notebookToParts } from "./formats/notebook";
import { pptxToParts } from "./formats/pptx";
import { describeWorkbookCharts } from "./formats/xlsx-charts";
import {
  abridgeTable,
  abridgeText,
  estimateCallCostUsd,
  estimateTextTokens,
  filePriority,
  MAX_FILE_BYTES,
  MAX_FILES_CONSIDERED,
  MAX_FILES_SENT,
  MAX_TOKENS_PER_FILE,
  MAX_TOKENS_PER_NATIVE_FILE,
  MAX_TOKENS_PER_SUBMISSION,
  skipReason,
  ZIP_MAX_DEPTH,
  ZIP_MAX_RATIO,
  ZIP_MAX_UNCOMPRESSED_BYTES,
  ZIP_RATIO_MIN_BYTES,
} from "./limits";

export { estimateTextTokens } from "./limits";

/**
 * Submission → Part[]. No chunking or ranking: a part is whole, or abridged
 * with a visible marker, or listed in the "skipped files" part with the
 * reason. A format we can't read becomes a part that says so.
 */

export interface SubmissionFile {
  name: string;
  mimeType?: string;
  /** Size in bytes when known up front, checked before loading. */
  size?: number;
  load(): Promise<Buffer>;
}

export interface SubmissionSource {
  /** The learner's typed answer, already plain text. */
  text?: string;
  files?: SubmissionFile[];
  urls?: string[];
  /** Question and rubric text; files named in it are sent first. */
  questionContext?: string;
}

export interface MaterializeLimits {
  maxFilesConsidered: number;
  maxFilesSent: number;
  maxTokensPerFile: number;
  /** Cap for a PDF or image sent as-is; text dumps use maxTokensPerFile. */
  maxTokensPerNativeFile: number;
  /** Estimated input tokens for the whole submission. */
  tokenBudget: number;
  /** Raw bytes per file; a larger file fails the submission. */
  maxFileBytes: number;
  /** Bytes across all parts as sent (base64 for files and images). */
  maxTotalBytes: number;
  /** Real (value-bearing) cells read from one worksheet. */
  maxSheetCells: number;
  zipMaxDepth: number;
  zipMaxUncompressedBytes: number;
  zipMaxRatio: number;
  zipRatioMinBytes: number;
}

export const DEFAULT_MATERIALIZE_LIMITS: MaterializeLimits = {
  maxFilesConsidered: MAX_FILES_CONSIDERED,
  maxFilesSent: MAX_FILES_SENT,
  maxTokensPerFile: MAX_TOKENS_PER_FILE,
  maxTokensPerNativeFile: MAX_TOKENS_PER_NATIVE_FILE,
  tokenBudget: MAX_TOKENS_PER_SUBMISSION,
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: 40 * 1024 * 1024,
  maxSheetCells: 250_000,
  zipMaxDepth: ZIP_MAX_DEPTH,
  zipMaxUncompressedBytes: ZIP_MAX_UNCOMPRESSED_BYTES,
  zipMaxRatio: ZIP_MAX_RATIO,
  zipRatioMinBytes: ZIP_RATIO_MIN_BYTES,
};

export interface MaterializeDeps {
  /** Turns a learner URL into parts; failures come back as a text part. */
  fetchUrl?: (url: string) => Promise<Part[]>;
}

export type MaterializeFailureCode =
  | "over_budget"
  | "part_too_large"
  | "submission_too_large";

export interface MaterializeStats {
  filesSeen: number;
  filesSent: number;
  filesSkipped: number;
  estimatedTokens: number;
  /** Worst case for one call: uncached input plus the full output budget. */
  estimatedCostUsd: number;
}

export type MaterializeResult =
  | {
      ok: true;
      parts: Part[];
      estimatedTokens: number;
      totalBytes: number;
      stats: MaterializeStats;
    }
  | {
      ok: false;
      code: MaterializeFailureCode;
      message: string;
      partName?: string;
      estimatedTokens?: number;
    };

/** A hard limit was hit; the submission fails rather than being cut. */
export class MaterializeLimitError extends Error {
  constructor(
    readonly code: MaterializeFailureCode,
    message: string,
    readonly partName?: string,
  ) {
    super(message);
    this.name = "MaterializeLimitError";
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "rst",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sql",
  "log",
  "py",
  "java",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "kt",
  "kts",
  "scala",
  "r",
  "m",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "dart",
  "lua",
  "pl",
  "jl",
  "sol",
  "vue",
  "svelte",
  "gradle",
  "dockerfile",
  "makefile",
  "tf",
  "graphql",
]);

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xlsm", "xls"]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);

export function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const lower = base.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return lower;
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot + 1);
}

const IMAGE_TOKEN_ESTIMATE = 1500;
const PDF_PAGE_TOKEN_ESTIMATE = 1600;

function countPdfPages(base64: string): number {
  const raw = Buffer.from(base64, "base64").toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page(?!s)/g);
  return Math.max(1, matches?.length ?? 0);
}

export function estimatePartTokens(part: Part): number {
  const header = 30;
  if (part.kind === "text") return header + estimateTextTokens(part.text ?? "");
  if (part.kind === "image") return header + IMAGE_TOKEN_ESTIMATE;
  return header + countPdfPages(part.base64 ?? "") * PDF_PAGE_TOKEN_ESTIMATE;
}

export function partBytes(part: Part): number {
  if (part.kind === "text") return Buffer.byteLength(part.text ?? "", "utf8");
  return (part.base64 ?? "").length;
}

export function estimatePartsTokens(parts: Part[]): number {
  return parts.reduce((sum, part) => sum + estimatePartTokens(part), 0);
}

export function couldNotReadPart(
  name: string,
  type: string | undefined,
  reason?: string,
): Part {
  const suffix = reason ? `: ${reason}` : "";
  return {
    name,
    kind: "text",
    text: `could not read ${name} (${type || "unknown type"})${suffix}`,
  };
}

/** A text part, abridged with a visible marker when over the per-file cap. */
function textPart(
  name: string,
  text: string,
  limits: MaterializeLimits,
  options: { mimeType?: string; tablePreambleLines?: number } = {},
): Part {
  let body = text;
  if (estimateTextTokens(text) > limits.maxTokensPerFile) {
    body =
      options.tablePreambleLines === undefined
        ? abridgeText(text, limits.maxTokensPerFile)
        : abridgeTable(
            text,
            limits.maxTokensPerFile,
            options.tablePreambleLines,
          );
  }
  return {
    name,
    kind: "text",
    text: body,
    ...(options.mimeType ? { mimeType: options.mimeType } : {}),
  };
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

const BYTE_ORDER_MARK = 0xfe_ff;

function decodeText(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  return text.codePointAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}

// ── spreadsheets ────────────────────────────────────────────────────────────

function csvField(value: string): string {
  return /[\n\r",]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function cellText(cell: XLSX.CellObject): string {
  if (cell.w !== undefined) return cell.w;
  if (cell.v === undefined || cell.v === null) return "";
  if (cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.v);
}

interface SheetText {
  csv: string;
  formulas: string[];
}

function sheetToText(
  worksheet: XLSX.WorkSheet,
  sheetLabel: string,
  limits: MaterializeLimits,
): SheetText {
  const rows = new Map<number, Map<number, string>>();
  const formulas: string[] = [];
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = -1;
  let cellCount = 0;

  // Walk real cell keys only; a declared range like A1:XFD1048576 is ignored.
  for (const key of Object.keys(worksheet)) {
    if (key.startsWith("!")) continue;
    const cell = worksheet[key] as XLSX.CellObject | undefined;
    if (!cell) continue;
    const value = cellText(cell);
    if (value === "" && !cell.f) continue;
    cellCount += 1;
    if (cellCount > limits.maxSheetCells) {
      throw new MaterializeLimitError(
        "part_too_large",
        `${sheetLabel} has more than ${limits.maxSheetCells} filled cells`,
        sheetLabel,
      );
    }
    const address = XLSX.utils.decode_cell(key);
    let row = rows.get(address.r);
    if (!row) {
      row = new Map();
      rows.set(address.r, row);
    }
    row.set(address.c, value);
    minCol = Math.min(minCol, address.c);
    maxCol = Math.max(maxCol, address.c);
    if (cell.f) formulas.push(`${key}: =${cell.f}`);
  }

  if (rows.size === 0) return { csv: "(empty sheet)", formulas };

  const columns: number[] = [];
  for (let col = minCol; col <= maxCol; col += 1) columns.push(col);
  const lines = [
    ["row", ...columns.map((col) => XLSX.utils.encode_col(col))].join(","),
  ];
  for (const rowIndex of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(rowIndex) ?? new Map<number, string>();
    lines.push(
      [
        String(rowIndex + 1),
        ...columns.map((col) => csvField(row.get(col) ?? "")),
      ].join(","),
    );
  }
  return { csv: lines.join("\n"), formulas };
}

async function spreadsheetToParts(
  name: string,
  buffer: Buffer,
  extension: string,
  limits: MaterializeLimits,
): Promise<Part[]> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellFormula: true,
      cellHTML: false,
      sheetStubs: false,
    });
  } catch (error) {
    return [
      couldNotReadPart(
        name,
        extension,
        error instanceof Error ? error.message : "unreadable workbook",
      ),
    ];
  }
  const parts: Part[] = [];
  // Hidden sheets are included: learners hide working sheets too.
  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const hiddenFlag = workbook.Workbook?.Sheets?.[index]?.Hidden ?? 0;
    const label = `${name} › ${sheetName}`;
    const hiddenNote = hiddenFlag > 0 ? " (hidden sheet)" : "";
    const sheet = sheetToText(worksheet, label, limits);
    parts.push(
      textPart(
        label,
        `Sheet "${sheetName}"${hiddenNote} of ${name}. Values as CSV; the first column is the row number, the header is the column letter.\n${sheet.csv}`,
        limits,
        { mimeType: "text/csv", tablePreambleLines: 1 },
      ),
    );
    if (sheet.formulas.length > 0) {
      parts.push(
        textPart(
          `${label} (formulas)`,
          `Formulas on sheet "${sheetName}" of ${name}:\n${sheet.formulas.join("\n")}`,
          limits,
        ),
      );
    }
  }
  if (extension !== "xls") {
    let charts: string | undefined;
    try {
      charts = await describeWorkbookCharts(buffer);
    } catch (error) {
      // Visible to the model rather than dropped: the sheets still grade.
      charts = `charts could not be read: ${error instanceof Error ? error.message : "unknown error"}`;
    }
    if (charts) parts.push(textPart(`${name} (charts)`, charts, limits));
  }
  if (parts.length === 0) {
    parts.push(couldNotReadPart(name, extension, "no sheets"));
  }
  return parts;
}

// ── one file ────────────────────────────────────────────────────────────────

/** Convert one file's bytes to parts by extension, then mime type. */
export async function bytesToParts(
  name: string,
  mimeType: string | undefined,
  buffer: Buffer,
  limits: MaterializeLimits = DEFAULT_MATERIALIZE_LIMITS,
): Promise<Part[]> {
  if (buffer.length > limits.maxFileBytes) {
    throw new MaterializeLimitError(
      "part_too_large",
      `${name} is ${buffer.length} bytes, over the ${limits.maxFileBytes} byte limit`,
      name,
    );
  }
  const extension = extensionOf(name);
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();

  if (extension === "pdf" || mime === "application/pdf") {
    return [
      {
        name,
        kind: "file",
        mimeType: "application/pdf",
        base64: buffer.toString("base64"),
      },
    ];
  }
  const imageType =
    IMAGE_TYPES[extension] ??
    (Object.values(IMAGE_TYPES).includes(mime) ? mime : undefined);
  if (imageType) {
    return [
      {
        name,
        kind: "image",
        mimeType: imageType,
        base64: buffer.toString("base64"),
      },
    ];
  }
  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return spreadsheetToParts(name, buffer, extension, limits);
  }
  if (extension === "ipynb") {
    try {
      // Notebook-aware: sources kept, outputs shrink first; never re-cut.
      const notebook = notebookToParts(
        name,
        decodeText(buffer),
        limits.maxTokensPerFile,
      );
      return [{ name, kind: "text", text: notebook.text }, ...notebook.images];
    } catch (error) {
      if (error instanceof MaterializeLimitError) throw error;
      return [couldNotReadPart(name, "ipynb", "not valid notebook JSON")];
    }
  }
  if (extension === "docx") {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      return [textPart(name, value, limits)];
    } catch (error) {
      if (error instanceof MaterializeLimitError) throw error;
      return [couldNotReadPart(name, "docx", "unreadable document")];
    }
  }
  if (extension === "pptx") {
    try {
      const [deck, ...images] = await pptxToParts(name, buffer);
      return [textPart(name, deck.text ?? "", limits), ...images];
    } catch (error) {
      if (error instanceof MaterializeLimitError) throw error;
      return [
        couldNotReadPart(
          name,
          "pptx",
          error instanceof Error ? error.message : "unreadable deck",
        ),
      ];
    }
  }
  const isText =
    TEXT_EXTENSIONS.has(extension) ||
    mime.startsWith("text/") ||
    mime === "application/json";
  if (isText) {
    if (looksBinary(buffer)) {
      return [couldNotReadPart(name, extension || mime, "binary content")];
    }
    const isTable = TABLE_EXTENSIONS.has(extension) || mime === "text/csv";
    return [
      textPart(name, decodeText(buffer), limits, {
        mimeType: mime || undefined,
        ...(isTable ? { tablePreambleLines: 0 } : {}),
      }),
    ];
  }
  return [couldNotReadPart(name, extension || mime || undefined)];
}

// ── archives ────────────────────────────────────────────────────────────────

interface CandidateFile {
  name: string;
  mimeType?: string;
  size?: number;
  load(): Promise<Buffer>;
  depth: number;
}

interface SkippedFile {
  name: string;
  reason: string;
}

interface ZipBudget {
  uncompressedBytes: number;
}

async function expandZip(
  archiveName: string,
  buffer: Buffer,
  depth: number,
  limits: MaterializeLimits,
  budget: ZipBudget,
  skipped: SkippedFile[],
): Promise<CandidateFile[]> {
  let directory: Awaited<ReturnType<typeof OpenZip.buffer>>;
  try {
    directory = await OpenZip.buffer(buffer);
  } catch {
    skipped.push({ name: archiveName, reason: "not a readable zip archive" });
    return [];
  }
  const entries: CandidateFile[] = [];
  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    const name = `${archiveName}/${entry.path}`;
    const reason = skipReason(entry.path);
    if (reason) {
      skipped.push({ name, reason });
      continue;
    }
    const size = entry.uncompressedSize;
    if (
      size >= limits.zipRatioMinBytes &&
      size > Math.max(entry.compressedSize, 1) * limits.zipMaxRatio
    ) {
      throw new MaterializeLimitError(
        "submission_too_large",
        `${name} expands ${Math.round(size / Math.max(entry.compressedSize, 1))}x; refusing a likely zip bomb`,
        name,
      );
    }
    budget.uncompressedBytes += size;
    if (budget.uncompressedBytes > limits.zipMaxUncompressedBytes) {
      throw new MaterializeLimitError(
        "submission_too_large",
        `archives expand past ${limits.zipMaxUncompressedBytes} bytes`,
        archiveName,
      );
    }
    entries.push({
      name,
      size,
      depth,
      load: async () => {
        const bytes = await entry.buffer();
        // The header can lie about the size; the bytes can't.
        if (bytes.length > Math.max(size, 0) + 1024) {
          throw new MaterializeLimitError(
            "submission_too_large",
            `${name} is larger than its archive header says`,
            name,
          );
        }
        return bytes;
      },
    });
  }
  return entries;
}

// ── whole submission ────────────────────────────────────────────────────────

interface ConvertedFile {
  name: string;
  order: number;
  priority: number;
  parts: Part[];
  tokens: number;
  bytes: number;
}

function skippedPart(skipped: SkippedFile[]): Part {
  const lines = skipped.map((file) => `- ${file.name}: ${file.reason}`);
  return {
    name: "skipped files",
    kind: "text",
    text: `${skipped.length} file(s) in the submission were not read or not sent to the grader:\n${lines.join("\n")}`,
  };
}

export async function materialize(
  source: SubmissionSource,
  deps: MaterializeDeps = {},
  limits: MaterializeLimits = DEFAULT_MATERIALIZE_LIMITS,
): Promise<MaterializeResult> {
  const fixedParts: Part[] = [];
  const skipped: SkippedFile[] = [];
  const converted: ConvertedFile[] = [];
  const questionContext = source.questionContext ?? "";
  let filesSeen = 0;

  try {
    if (typeof source.text === "string" && source.text.trim().length > 0) {
      fixedParts.push(textPart("answer", source.text, limits));
    }
    for (const url of source.urls ?? []) {
      if (!deps.fetchUrl) {
        fixedParts.push(
          couldNotReadPart(url, "url", "links are not fetched here"),
        );
        continue;
      }
      for (const part of await deps.fetchUrl(url)) {
        fixedParts.push(
          part.kind === "text"
            ? textPart(part.name, part.text ?? "", limits)
            : part,
        );
      }
    }

    // Expand archives and apply the skip list before reading any file bytes.
    const zipBudget: ZipBudget = { uncompressedBytes: 0 };
    const queue: CandidateFile[] = (source.files ?? []).map((file) => ({
      ...file,
      depth: 0,
    }));
    const candidates: CandidateFile[] = [];
    while (queue.length > 0) {
      const file = queue.shift();
      filesSeen += 1;
      const reason = file.depth === 0 ? skipReason(file.name) : undefined;
      if (reason) {
        skipped.push({ name: file.name, reason });
        continue;
      }
      if (candidates.length >= limits.maxFilesConsidered) {
        skipped.push({
          name: file.name,
          reason: `over the ${limits.maxFilesConsidered}-file limit`,
        });
        continue;
      }
      if (file.size !== undefined && file.size > limits.maxFileBytes) {
        throw new MaterializeLimitError(
          "part_too_large",
          `${file.name} is ${file.size} bytes, over the ${limits.maxFileBytes} byte limit`,
          file.name,
        );
      }
      if (extensionOf(file.name) === "zip") {
        if (file.depth >= limits.zipMaxDepth) {
          skipped.push({ name: file.name, reason: "archive nested too deep" });
          continue;
        }
        const buffer = await file.load();
        queue.push(
          ...(await expandZip(
            file.name,
            buffer,
            file.depth + 1,
            limits,
            zipBudget,
            skipped,
          )),
        );
        continue;
      }
      candidates.push(file);
    }

    for (const [order, file] of candidates.entries()) {
      const buffer = await file.load();
      const parts = await bytesToParts(
        file.name,
        file.mimeType,
        buffer,
        limits,
      );
      const tooBig = parts.find(
        (part) =>
          part.kind !== "text" &&
          estimatePartTokens(part) > limits.maxTokensPerNativeFile,
      );
      if (tooBig) {
        skipped.push({
          name: file.name,
          reason: `not sent: about ${estimatePartTokens(tooBig)} tokens, over the ${limits.maxTokensPerNativeFile}-token per-file cap`,
        });
        continue;
      }
      converted.push({
        name: file.name,
        order,
        priority: filePriority(file.name, questionContext),
        parts,
        tokens: estimatePartsTokens(parts),
        bytes: parts.reduce((sum, part) => sum + partBytes(part), 0),
      });
    }
  } catch (error) {
    if (error instanceof MaterializeLimitError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        partName: error.partName,
      };
    }
    throw error;
  }

  // Fill the budget by priority; what doesn't fit is listed, not dropped.
  let tokens = estimatePartsTokens(fixedParts);
  let bytes = fixedParts.reduce((sum, part) => sum + partBytes(part), 0);
  const chosen: ConvertedFile[] = [];
  const byPriority = [...converted].sort(
    (a, b) => a.priority - b.priority || a.order - b.order,
  );
  for (const file of byPriority) {
    const fits =
      chosen.length < limits.maxFilesSent &&
      tokens + file.tokens <= limits.tokenBudget &&
      bytes + file.bytes <= limits.maxTotalBytes;
    if (fits) {
      chosen.push(file);
      tokens += file.tokens;
      bytes += file.bytes;
    } else {
      skipped.push({
        name: file.name,
        reason:
          chosen.length >= limits.maxFilesSent
            ? `not sent (over the ${limits.maxFilesSent}-file limit)`
            : "not sent (budget)",
      });
    }
  }
  chosen.sort((a, b) => a.order - b.order);

  const parts = [...fixedParts, ...chosen.flatMap((file) => file.parts)];
  if (skipped.length > 0) parts.push(skippedPart(skipped));
  const estimatedTokens = estimatePartsTokens(parts);
  if (estimatedTokens > limits.tokenBudget) {
    return {
      ok: false,
      code: "over_budget",
      message: `submission is about ${estimatedTokens} tokens, over the ${limits.tokenBudget} token budget`,
      estimatedTokens,
    };
  }
  const totalBytes = parts.reduce((sum, part) => sum + partBytes(part), 0);
  return {
    ok: true,
    parts,
    estimatedTokens,
    totalBytes,
    stats: {
      filesSeen,
      filesSent: chosen.length,
      filesSkipped: skipped.length,
      estimatedTokens,
      estimatedCostUsd: estimateCallCostUsd(estimatedTokens),
    },
  };
}
