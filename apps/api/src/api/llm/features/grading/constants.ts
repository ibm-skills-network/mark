// Hard cap on the number of evidence blocks a single submission can produce.
// Largest legitimate submissions (capstone PDFs, lecture-deck spreadsheets)
// stay under ~1000 blocks; 50000 gives 50x headroom while still being orders
// of magnitude smaller than the 1M+ explosion that crashes the worker pod.
//
// Shared so every submission ingestion path (spreadsheet text splitting and
// PDF structure extraction) enforces the SAME ceiling.
//
// Tunable per environment via the GRADING_MAX_EVIDENCE_BLOCKS env var; falls
// back to the default whenever that var is unset, empty, or not a positive
// integer. Read once at module load (the value is a static deployment knob).
const DEFAULT_MAX_EVIDENCE_BLOCKS_PER_SUBMISSION = 50_000;

export function resolveMaxEvidenceBlocksPerSubmission(): number {
  const parsed = Number.parseInt(
    process.env.GRADING_MAX_EVIDENCE_BLOCKS ?? "",
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_EVIDENCE_BLOCKS_PER_SUBMISSION;
}

export const MAX_EVIDENCE_BLOCKS_PER_SUBMISSION =
  resolveMaxEvidenceBlocksPerSubmission();

// Hard cap on the number of cells (rows × columns) a single spreadsheet
// submission may expand into after it is compacted to its real data. A genuine
// dataset stays well under this; the cap exists to reject pathological sheets
// (e.g. a table sized to the whole grid) before any walk materializes them.
//
// Tunable per environment via GRADING_MAX_SPREADSHEET_CELLS; falls back to the
// default whenever that var is unset, empty, or not a positive integer.
const DEFAULT_MAX_SPREADSHEET_CELLS_PER_SUBMISSION = 1_000_000;

export function resolveMaxSpreadsheetCellsPerSubmission(): number {
  const parsed = Number.parseInt(
    process.env.GRADING_MAX_SPREADSHEET_CELLS ?? "",
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_SPREADSHEET_CELLS_PER_SUBMISSION;
}

export const MAX_SPREADSHEET_CELLS_PER_SUBMISSION =
  resolveMaxSpreadsheetCellsPerSubmission();

/**
 * Learner-facing feedback persisted when a submission trips a severe
 * moderation category and is not sent to the grading model.
 */
export const MODERATION_BLOCK_FEEDBACK =
  "Your submission was flagged by automated content review and could not be graded automatically. Please contact your instructor.";
