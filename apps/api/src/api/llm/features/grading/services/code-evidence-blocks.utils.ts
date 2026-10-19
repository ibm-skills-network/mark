import { ContentBlock } from "src/api/attempt/services/structured-content.models";
import { Logger } from "winston";
import { MAX_EVIDENCE_BLOCKS_PER_SUBMISSION } from "../constants";
import { OversizedSubmissionError } from "../errors/oversized-submission.error";
import {
  CODE_MIN_SEGMENT_CHARS,
  CODE_SEGMENT_MAX_CHARS,
  CODE_WHOLE_FILE_BLOCK_MAX_CHARS,
  sanitizeFilenameForMarker,
} from "./source-code.utils";

// Code-aware evidence blocks shared by file uploads and code file URLs.

// Normalize line endings and strip control characters, leaving tabs and
// newlines intact. Shared by the prose and code normalizers, which then
// differ only in how they treat tabs and trimming.
export function normalizeNewlinesAndControlChars(text: string): string {
  return (
    text
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

// Prose normalization flattens tabs to spaces, which destroys indentation
// in tab-indented code. Keep tabs; only strip CR and other control chars.
export function normalizeCodeSubmissionText(text: string): string {
  return normalizeNewlinesAndControlChars(text).replace(/^\n+/, "").trimEnd();
}

export function buildCodeEvidenceBlocks(
  code: string,
  startIndex: number,
  meta?: { filename?: string; questionId?: number; attemptId?: number },
  logger?: Pick<Logger, "warn">,
): ContentBlock[] {
  // The filename feeds the trusted `=== FILE: ... ===` marker below and is
  // learner-controlled — sanitize it so it cannot forge or break the marker.
  const filename = sanitizeFilenameForMarker(meta?.filename) || "submission";
  if (!code) {
    return [
      {
        blockId: `p1b${startIndex}`,
        type: "code",
        text: "",
        page: 1,
        pinnedEvidence: true,
      },
    ];
  }

  const blocks: ContentBlock[] = [];
  let index = startIndex;

  // Guard on total block count (whole-file block + one per segment), mirroring
  // splitTextIntoEvidenceBlocks' protection against pathologically large
  // submissions overwhelming the evidence pipeline.
  const segments = splitCodeIntoSegments(code);
  const blockCount = segments.length + 1;
  if (blockCount > MAX_EVIDENCE_BLOCKS_PER_SUBMISSION) {
    logger?.warn("grading.submission.oversized", {
      blockCount,
      cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
      filename: meta?.filename,
      questionId: meta?.questionId,
      attemptId: meta?.attemptId,
      branch: "code",
    });
    throw new OversizedSubmissionError({
      blockCount,
      cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
      filename: meta?.filename,
      questionId: meta?.questionId,
      attemptId: meta?.attemptId,
    });
  }

  // Pinned whole-file block: holistic criteria (correctness, style,
  // structure) concern the entire program, so the evidence validator must
  // always get to judge the file as one unit — per-function chunks alone
  // would make such criteria look unsupported.
  //
  // The block's ENTIRE text (header + code + marker) is bounded to
  // CODE_WHOLE_FILE_BLOCK_MAX_CHARS so it survives quoting intact (see the
  // invariant on CODE_EVIDENCE_QUOTE_MAX_CHARS): if it were only the *code*
  // that was bounded, the header/marker would push the total past the quote
  // cap and the marker would be sliced off.
  const marker = "\n... [file truncated]";
  const truncatedHeader = `=== FILE: ${filename} (truncated) ===\n`;
  const codeBudget =
    CODE_WHOLE_FILE_BLOCK_MAX_CHARS - truncatedHeader.length - marker.length;
  // A file only counts as truncated when the COMPLETE block would not fit;
  // comparing against the (smaller) truncated-block budget would clip files
  // that fit whole and mislabel them.
  const completeText = `=== FILE: ${filename} (complete) ===\n${code}`;
  const wholeFileText =
    completeText.length <= CODE_WHOLE_FILE_BLOCK_MAX_CHARS
      ? completeText
      : `${truncatedHeader}${code.slice(0, codeBudget)}${marker}`;
  blocks.push({
    blockId: `p1b${index}`,
    type: "code",
    text: wholeFileText,
    page: 1,
    pinnedEvidence: true,
  });
  index += 1;

  for (const segment of segments) {
    blocks.push({
      blockId: `p1b${index}`,
      type: "code",
      text: segment,
      page: 1,
    });
    index += 1;
  }

  return blocks;
}

// Split source at top-level definitions (functions, classes, etc.) so each
// evidence block is a self-contained unit. Comment/decorator lines sitting
// directly above a definition travel with it. Notebook extractions split at
// cell boundaries instead (a cell is the notebook's natural unit). Falls
// back to blank-line groups — indentation preserved — when no definitions
// are found.
export function splitCodeIntoSegments(code: string): string[] {
  const cellSegments = splitNotebookIntoCellSegments(code);
  if (cellSegments) {
    return capCodeSegments(mergeTinyCodeSegments(cellSegments));
  }

  const definitionStart =
    /^(?:export\s+|default\s+|declare\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|abstract\s+|async\s+|unsafe\s+|pub(?:\([^)]*\))?\s+)*(?:def|class|function|func|fn|interface|struct|enum|impl|trait|type|namespace|module|const|let|var)\b/;
  const attachment = /^(?:@|#|\/\/|\/\*|\*|--|'''|""")/;

  const lines = code.split("\n");
  const segments: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isBoundary = !/^\s/.test(line) && definitionStart.test(line);
    if (isBoundary && current.length > 0) {
      const attached: string[] = [];
      for (
        let previous = current.at(-1);
        previous !== undefined && attachment.test(previous.trim());
        previous = current.at(-1)
      ) {
        current.pop();
        attached.unshift(previous);
      }
      const text = current.join("\n").trimEnd();
      if (text.trim()) segments.push(text);
      current = [...attached];
    }
    current.push(line);
  }
  const tail = current.join("\n").trimEnd();
  if (tail.trim()) segments.push(tail);

  if (segments.length <= 1) {
    const paragraphs = code
      .split(/\n{2,}/)
      .map((chunk) => chunk.trimEnd())
      .filter((chunk) => chunk.trim());
    if (paragraphs.length > 1) {
      return capCodeSegments(mergeTinyCodeSegments(paragraphs));
    }
  }

  return capCodeSegments(mergeTinyCodeSegments(segments));
}

// Jupyter notebook extractions carry "=== CELL N [TYPE] ===" section
// headers (see FileContentExtractionService.extractJupyterNotebook).
// Returns null when the text is not a notebook extraction.
//
// Cells are grouped into task sections rather than kept one-per-segment: a
// rubric criterion's wording matches the markdown task cell, but the work
// that satisfies it lives in the code cells that follow. Evidence retrieval
// selects whole chunks, so a task's description and its answer code must
// share a chunk — a lone markdown cell that parrots the rubric otherwise
// outranks the learner's code everywhere and the grader never sees the code.
function splitNotebookIntoCellSegments(code: string): string[] | null {
  const cellHeader = /^=== CELL \d+ \[/m;
  if (!cellHeader.test(code)) return null;

  const cells = code
    .split(/\n(?==== CELL \d+ \[)/)
    .map((segment) => segment.trimEnd())
    .filter((segment) => segment.trim());
  if (cells.length === 0) return null;

  // A section starts at each markdown run (a markdown cell whose
  // predecessor is not markdown) and carries every following cell until the
  // next run. Sections are bounded by CODE_SEGMENT_MAX_CHARS so they
  // survive capCodeSegments un-split; a cell that would overflow starts its
  // own section (the pre-grouping behaviour) rather than shearing the
  // section mid-cell.
  const markdownCellHeader = /^=== CELL \d+ \[MARKDOWN]/;

  const sections: string[] = [];
  let current: string[] = [];
  let currentSize = 0;
  let previousWasMarkdown = false;

  for (const cell of cells) {
    const markdown = markdownCellHeader.test(cell);
    const startsNewSection =
      markdown && !previousWasMarkdown && current.length > 0;
    const overflows =
      current.length > 0 &&
      currentSize + cell.length + 1 > CODE_SEGMENT_MAX_CHARS;

    if (startsNewSection || overflows) {
      sections.push(current.join("\n"));
      current = [];
      currentSize = 0;
    }

    current.push(cell);
    currentSize += cell.length + 1;
    previousWasMarkdown = markdown;
  }
  if (current.length > 0) sections.push(current.join("\n"));

  return sections;
}

// Fold trivially short segments (a lone import, a one-line `const`) into an
// adjacent segment so they don't occupy a candidate slot on their own. Small
// segments merge into the preceding one; a small leading segment with no
// predecessor is folded forward into the next.
function mergeTinyCodeSegments(segments: string[]): string[] {
  const merged: string[] = [];
  for (const segment of segments) {
    const isTiny = segment.trim().length < CODE_MIN_SEGMENT_CHARS;
    if (isTiny && merged.length > 0) {
      merged[merged.length - 1] = `${merged.at(-1)}\n${segment}`;
      continue;
    }
    merged.push(segment);
  }

  if (merged.length > 1 && merged[0].trim().length < CODE_MIN_SEGMENT_CHARS) {
    merged[1] = `${merged[0]}\n${merged[1]}`;
    merged.shift();
  }

  return merged;
}

function capCodeSegments(segments: string[]): string[] {
  const capped: string[] = [];
  for (const segment of segments) {
    if (segment.length <= CODE_SEGMENT_MAX_CHARS) {
      capped.push(segment);
      continue;
    }
    let buffer: string[] = [];
    let size = 0;
    for (const line of segment.split("\n")) {
      if (
        size + line.length + 1 > CODE_SEGMENT_MAX_CHARS &&
        buffer.length > 0
      ) {
        capped.push(buffer.join("\n"));
        buffer = [];
        size = 0;
      }
      // A single line can exceed the cap on its own (minified bundles, long
      // data literals) and has no line boundary to split at — hard-slice it
      // so the "segments always fit" invariant holds.
      if (line.length > CODE_SEGMENT_MAX_CHARS) {
        for (
          let offset = 0;
          offset < line.length;
          offset += CODE_SEGMENT_MAX_CHARS
        ) {
          capped.push(line.slice(offset, offset + CODE_SEGMENT_MAX_CHARS));
        }
        continue;
      }
      buffer.push(line);
      size += line.length + 1;
    }
    if (buffer.length > 0) capped.push(buffer.join("\n"));
  }
  return capped;
}
