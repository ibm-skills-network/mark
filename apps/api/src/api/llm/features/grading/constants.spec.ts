import { resolveMaxSpreadsheetCellsPerSubmission } from "./constants";

describe("resolveMaxSpreadsheetCellsPerSubmission", () => {
  const original = process.env.GRADING_MAX_SPREADSHEET_CELLS;
  afterEach(() => {
    if (original === undefined)
      delete process.env.GRADING_MAX_SPREADSHEET_CELLS;
    else process.env.GRADING_MAX_SPREADSHEET_CELLS = original;
  });

  it("defaults to 1,000,000 when the env var is unset", () => {
    delete process.env.GRADING_MAX_SPREADSHEET_CELLS;
    expect(resolveMaxSpreadsheetCellsPerSubmission()).toBe(1_000_000);
  });

  it("honors a positive integer override", () => {
    process.env.GRADING_MAX_SPREADSHEET_CELLS = "250000";
    expect(resolveMaxSpreadsheetCellsPerSubmission()).toBe(250_000);
  });

  it("falls back to the default for non-positive or non-integer values", () => {
    process.env.GRADING_MAX_SPREADSHEET_CELLS = "0";
    expect(resolveMaxSpreadsheetCellsPerSubmission()).toBe(1_000_000);
    process.env.GRADING_MAX_SPREADSHEET_CELLS = "abc";
    expect(resolveMaxSpreadsheetCellsPerSubmission()).toBe(1_000_000);
  });
});
