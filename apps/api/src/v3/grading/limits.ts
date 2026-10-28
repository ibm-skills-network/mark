/**
 * Input caps for v3 grading: what we never read, how much we send, and how
 * an oversized file is abridged. Every skip or cut is listed for the model
 * and the learner; nothing is dropped silently.
 */

export const MAX_FILES_CONSIDERED = 200;
export const MAX_FILES_SENT = 50;
export const MAX_TOKENS_PER_FILE = 40_000;
/** PDFs and images go to the model as-is; about 100 PDF pages. */
export const MAX_TOKENS_PER_NATIVE_FILE = 160_000;
/** Stays under the provider's long-context price step (272k input). */
export const MAX_TOKENS_PER_SUBMISSION = 200_000;
/** Raw bytes for one file before conversion; over this it is not loaded. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const ZIP_MAX_DEPTH = 2;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** An entry this many times larger than its compressed size is a bomb... */
export const ZIP_MAX_RATIO = 100;
/** ...once it is at least this big (tiny files compress absurdly well). */
export const ZIP_RATIO_MIN_BYTES = 1024 * 1024;

export const TABLE_HEAD_ROWS = 200;
export const TABLE_TAIL_ROWS = 20;

/** USD per million tokens (GPT-6 Luna list price). */
export const PRICE_INPUT_PER_M = 0.1;
export const PRICE_CACHED_INPUT_PER_M = 0.01;
export const PRICE_OUTPUT_PER_M = 0.5;
export const MAX_OUTPUT_TOKENS = 16_000;
/** Estimated cost above which a question fails instead of calling the model. */
export const COST_CEILING_USD = 0.05;

export function estimateCostUsd(tokens: {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): number {
  const cached = tokens.cachedInputTokens ?? 0;
  return (
    ((tokens.inputTokens - cached) * PRICE_INPUT_PER_M +
      cached * PRICE_CACHED_INPUT_PER_M +
      tokens.outputTokens * PRICE_OUTPUT_PER_M) /
    1_000_000
  );
}

/** Worst-case cost of one call: all input uncached, full output budget. */
export function estimateCallCostUsd(estimatedInputTokens: number): number {
  return estimateCostUsd({
    inputTokens: estimatedInputTokens,
    outputTokens: MAX_OUTPUT_TOKENS,
  });
}

// ── skip list ───────────────────────────────────────────────────────────────

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  ".ipynb_checkpoints",
  "dist",
  "build",
  "target",
  ".next",
  "coverage",
  "vendor",
  ".idea",
  ".vscode",
  "__macosx",
]);

const SKIPPED_FILENAMES = new Set([
  ".ds_store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pipfile.lock",
]);

const SKIPPED_EXTENSIONS = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "class",
  "jar",
  "pyc",
  "pyo",
  "o",
  "obj",
  "a",
  "wasm",
  "h5",
  "hdf5",
  "pt",
  "pth",
  "pkl",
  "pickle",
  "onnx",
  "bin",
  "safetensors",
  "ckpt",
  "map",
]);

/** Why a path is never read, or undefined when it may be. */
export function skipReason(path: string): string | undefined {
  const segments = path.split(/[/\\]/).filter((segment) => segment.length > 0);
  const base = (segments.at(-1) ?? "").toLowerCase();
  for (const directory of segments.slice(0, -1)) {
    if (SKIPPED_DIRECTORIES.has(directory.toLowerCase())) {
      return `inside ${directory}/`;
    }
  }
  if (SKIPPED_FILENAMES.has(base)) return "lockfile or system file";
  if (base.endsWith(".min.js") || base.endsWith(".min.css")) {
    return "minified file";
  }
  const dot = base.lastIndexOf(".");
  const extension = dot === -1 ? "" : base.slice(dot + 1);
  if (SKIPPED_EXTENSIONS.has(extension))
    return `.${extension} file not readable`;
  return undefined;
}

// ── priority when over budget ───────────────────────────────────────────────

const SOURCE_AND_DOC_EXTENSIONS = new Set([
  "py",
  "ipynb",
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
  "sql",
  "html",
  "htm",
  "css",
  "scss",
  "vue",
  "svelte",
  "dart",
  "lua",
  "pl",
  "jl",
  "sol",
  "md",
  "markdown",
  "rst",
  "txt",
  "pdf",
  "docx",
]);

const DATA_EXTENSIONS = new Set([
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xlsx",
  "xlsm",
  "xls",
  "xml",
  "yml",
  "yaml",
  "parquet",
]);

function extension(path: string): string {
  const base = (path.split(/[/\\]/).pop() ?? "").toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1);
}

/**
 * 0 = named in the question or rubric, 1 = source code, notebooks and
 * documents, 2 = data, 3 = everything else. Lower is sent first.
 */
export function filePriority(
  path: string,
  questionAndRubricText: string,
): number {
  const base = (path.split(/[/\\]/).pop() ?? "").toLowerCase();
  if (base.length > 0 && questionAndRubricText.toLowerCase().includes(base)) {
    return 0;
  }
  const extension_ = extension(path);
  if (SOURCE_AND_DOC_EXTENSIONS.has(extension_)) return 1;
  if (DATA_EXTENSIONS.has(extension_)) return 2;
  return 3;
}

// ── abridging ───────────────────────────────────────────────────────────────

/** Rough token estimate for text (code runs denser than prose). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function maxCharsFor(tokens: number): number {
  return Math.floor(tokens * 3.5);
}

/**
 * Tabular text over the cap: header, the first rows, the last rows and the
 * counts, with a visible marker where rows were left out. Lines before the
 * header (a sheet title) are kept.
 */
export function abridgeTable(
  text: string,
  maxTokens: number = MAX_TOKENS_PER_FILE,
  preambleLines = 0,
): string {
  const lines = text.split("\n");
  const preamble = lines.slice(0, preambleLines);
  const header = lines[preambleLines] ?? "";
  const rows = lines.slice(preambleLines + 1);
  const columnCount = header.split(",").length;
  if (rows.length <= TABLE_HEAD_ROWS + TABLE_TAIL_ROWS) {
    return abridgeText(text, maxTokens);
  }
  const head = rows.slice(0, TABLE_HEAD_ROWS);
  const tail = rows.slice(-TABLE_TAIL_ROWS);
  const firstOmitted = TABLE_HEAD_ROWS + 1;
  const lastOmitted = rows.length - TABLE_TAIL_ROWS;
  const note = `[abridged: ${rows.length} data rows × ${columnCount} columns; rows ${firstOmitted}–${lastOmitted} omitted]`;
  const abridged = [
    note,
    ...preamble,
    header,
    ...head,
    `[... rows ${firstOmitted}–${lastOmitted} omitted ...]`,
    ...tail,
  ].join("\n");
  // Very wide rows can still be over: cut again as plain text.
  return estimateTextTokens(abridged) > maxTokens
    ? abridgeText(abridged, maxTokens)
    : abridged;
}

/** Text over the cap: the start and the end, with an explicit marker. */
export function abridgeText(
  text: string,
  maxTokens: number = MAX_TOKENS_PER_FILE,
): string {
  const budget = maxCharsFor(maxTokens) - 300;
  if (text.length <= budget) return text;
  const headChars = Math.floor(budget * 0.75);
  const tailChars = budget - headChars;
  const omitted = text.length - headChars - tailChars;
  return [
    `[abridged: ${text.length} characters, about ${estimateTextTokens(text)} tokens; the middle ${omitted} characters are omitted]`,
    text.slice(0, headChars),
    `[... ${omitted} characters omitted ...]`,
    text.slice(-tailChars),
  ].join("\n");
}
