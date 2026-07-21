/**
 * Shared detection for source-code uploads so the routing gate
 * (file-grading.service) and the evidence retrieval layer agree on what
 * counts as code.
 */
const SOURCE_CODE_EXTENSION_REGEX =
  /\.(py|java|cpp|cc|cxx|c|h|hpp|hh|js|jsx|mjs|cjs|ts|tsx|go|rs|rb|cs|php|swift|kt|kts|scala|sql|sh|bash|pl|pm|lua|dart|m|mm)$/;

export function isSourceCodeFilename(filename?: string | null): boolean {
  if (!filename) return false;
  return SOURCE_CODE_EXTENSION_REGEX.test(filename.toLowerCase());
}

/**
 * Upper bound for the *entire* text of the pinned whole-file evidence block
 * (header + code + truncation marker, all counted). The whole-file builder
 * bounds the block to exactly this length.
 */
export const CODE_WHOLE_FILE_BLOCK_MAX_CHARS = 12_000;

/**
 * Evidence quotes are normally capped at ~220 chars, which is enough for
 * prose but destroys code (a fragment can't show whether a function works).
 * Source-file chunks keep their full text up to this cap instead.
 *
 * INVARIANT: this must be >= CODE_WHOLE_FILE_BLOCK_MAX_CHARS. The quote is a
 * slice of the chunk's text, so a smaller cap would re-truncate the pinned
 * whole-file block — dropping its "[file truncated]" marker and making a
 * truncated file read as "(complete)" to the grader. Keeping the two equal
 * satisfies the invariant (segments are separately bounded to the smaller
 * CODE_SEGMENT_MAX_CHARS, so they always fit).
 */
export const CODE_EVIDENCE_QUOTE_MAX_CHARS = CODE_WHOLE_FILE_BLOCK_MAX_CHARS;

/** Segments longer than this are re-split at line boundaries. */
export const CODE_SEGMENT_MAX_CHARS = 6000;

/**
 * Segments shorter than this (trimmed) are merged into a neighbor rather than
 * becoming their own evidence candidate. Keeps trivial top-level statements
 * (e.g. a lone `const X = 1` or an import line) from crowding out substantial
 * definitions in the limited candidate window.
 */
export const CODE_MIN_SEGMENT_CHARS = 200;
