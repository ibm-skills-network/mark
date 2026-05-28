// Hard cap on the number of evidence blocks a single submission can produce.
// Largest legitimate submissions (capstone PDFs, lecture-deck spreadsheets)
// stay under ~1000 blocks; 50000 gives 50x headroom while still being orders
// of magnitude smaller than the 1M+ explosion that crashes the worker pod.
//
// Shared so every submission ingestion path (spreadsheet text splitting and
// PDF structure extraction) enforces the SAME ceiling.
export const MAX_EVIDENCE_BLOCKS_PER_SUBMISSION = 50_000;
