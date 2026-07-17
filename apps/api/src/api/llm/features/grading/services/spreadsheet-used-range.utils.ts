import * as XLSX from "xlsx";
import {
  MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
  MAX_SPREADSHEET_CELLS_PER_SUBMISSION,
} from "../constants";
import { OversizedSubmissionError } from "../errors/oversized-submission.error";

/**
 * Walk only real cell keys on the worksheet and compute the bounding box of
 * cells that actually carry a value. SheetJS preserves the worksheet's
 * declared dimension verbatim in `!ref`, which on Excel files saved with a
 * full-sheet formal dimension (`A1:XFD1048576`) covers 17 billion virtual
 * cells. Trusting that value blindly causes downstream consumers such as
 * `sheet_to_json` to materialize a row for every virtual row in the sheet.
 * Returns null when the worksheet contains no real cells.
 */
export function computeUsedRange(worksheet: XLSX.WorkSheet): XLSX.Range | null {
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const key in worksheet) {
    if (key.codePointAt(0) === 33) continue; // '!' meta key
    const cell = worksheet[key] as XLSX.CellObject;
    if (cell.t === "z") continue; // style-only placeholder, carries no value
    const addr = XLSX.utils.decode_cell(key);
    if (
      !Number.isFinite(addr.r) ||
      !Number.isFinite(addr.c) ||
      addr.r < 0 ||
      addr.c < 0
    ) {
      continue;
    }
    found = true;
    if (addr.r < minRow) minRow = addr.r;
    if (addr.c < minCol) minCol = addr.c;
    if (addr.r > maxRow) maxRow = addr.r;
    if (addr.c > maxCol) maxCol = addr.c;
  }

  if (!found) return null;

  return {
    s: { r: minRow, c: minCol },
    e: { r: maxRow, c: maxCol },
  };
}

export interface SpreadsheetBudgetMeta {
  filename?: string;
  questionId?: number;
  attemptId?: number;
}

function assertSpreadsheetWithinBudget(
  rowCount: number,
  cellCount: number,
  meta?: SpreadsheetBudgetMeta,
): void {
  const overRows = rowCount > MAX_EVIDENCE_BLOCKS_PER_SUBMISSION;
  const overCells = cellCount > MAX_SPREADSHEET_CELLS_PER_SUBMISSION;
  if (!overRows && !overCells) return;
  throw new OversizedSubmissionError({
    blockCount: overRows ? rowCount : cellCount,
    cap: overRows
      ? MAX_EVIDENCE_BLOCKS_PER_SUBMISSION
      : MAX_SPREADSHEET_CELLS_PER_SUBMISSION,
    filename: meta?.filename,
    questionId: meta?.questionId,
    attemptId: meta?.attemptId,
  });
}

/**
 * Rewrite a worksheet so `!ref` spans only its real data. Walks value-bearing
 * cells once (O(real cells)): collects populated rows and "meaningful" columns
 * (columns carrying a value in any row other than the topmost populated row —
 * the de-facto header). When data is already contiguous and no column is
 * pruned, only `!ref` is tightened (identical to the prior bounding-box clamp).
 * Otherwise cells are remapped to a dense range so a far-flung total or a
 * full-grid table does not force downstream `!ref` walks to span the gap.
 * Throws OversizedSubmissionError when the compacted sheet is still over budget.
 */
export function compactWorksheet(
  ws: XLSX.WorkSheet,
  meta?: SpreadsheetBudgetMeta,
): void {
  const realCells: { r: number; c: number; key: string }[] = [];
  const rowSet = new Set<number>();
  const allColSet = new Set<number>();
  let topRow = Number.POSITIVE_INFINITY;

  for (const key in ws) {
    if (key.codePointAt(0) === 33) continue; // '!' meta
    const cell = ws[key] as XLSX.CellObject;
    if (cell.t === "z") continue; // style-only stub, no value
    const a = XLSX.utils.decode_cell(key);
    if (!Number.isFinite(a.r) || !Number.isFinite(a.c) || a.r < 0 || a.c < 0) {
      continue;
    }
    realCells.push({ r: a.r, c: a.c, key });
    rowSet.add(a.r);
    allColSet.add(a.c);
    if (a.r < topRow) topRow = a.r;
  }

  if (realCells.length === 0) {
    delete ws["!ref"];
    return;
  }

  const belowTopColSet = new Set<number>();
  for (const { r, c } of realCells) {
    if (r !== topRow) belowTopColSet.add(c);
  }
  const cols = (
    belowTopColSet.size > 0 ? [...belowTopColSet] : [...allColSet]
  ).sort((x, y) => x - y);
  const rows = [...rowSet].sort((x, y) => x - y);

  assertSpreadsheetWithinBudget(rows.length, rows.length * cols.length, meta);

  const firstRow = rows[0];
  const firstCol = cols[0];
  const lastRow = rows.at(-1);
  const lastCol = cols.at(-1);
  // Unreachable in practice: a sheet with real cells always yields rows/cols.
  if (lastRow === undefined || lastCol === undefined) return;

  const rowsContiguous = lastRow - firstRow + 1 === rows.length;
  const colsContiguous = lastCol - firstCol + 1 === cols.length;
  const colsAllKept = cols.length === allColSet.size;

  if (rowsContiguous && colsContiguous && colsAllKept) {
    // Identity case: no gaps, nothing pruned — just tighten !ref (the original
    // bounding-box clamp). Cells are left exactly where they are.
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: firstRow, c: firstCol },
      e: { r: lastRow, c: lastCol },
    });
    return;
  }

  // Compaction: remap to a dense, 0-based range.
  const rowRemap = new Map<number, number>();
  for (const [index, r] of rows.entries()) rowRemap.set(r, index);
  const colRemap = new Map<number, number>();
  for (const [index, c] of cols.entries()) colRemap.set(c, index);
  const colKept = new Set(cols);

  const newCells: Record<string, XLSX.CellObject> = {};
  for (const { r, c, key } of realCells) {
    if (!colKept.has(c)) continue; // prune non-meaningful columns
    const nr = rowRemap.get(r);
    const nc = colRemap.get(c);
    if (nr === undefined || nc === undefined) continue;
    newCells[XLSX.utils.encode_cell({ r: nr, c: nc })] = ws[
      key
    ] as XLSX.CellObject;
  }

  const comments = ws["!comments"] as Record<string, unknown> | undefined;
  let newComments: Record<string, unknown> | undefined;
  if (comments) {
    newComments = {};
    for (const cAddr in comments) {
      const a = XLSX.utils.decode_cell(cAddr);
      const nr = rowRemap.get(a.r);
      const nc = colRemap.get(a.c);
      if (nr !== undefined && nc !== undefined) {
        const na = XLSX.utils.encode_cell({ r: nr, c: nc });
        newComments[na] = comments[cAddr];
      }
    }
  }

  // Wipe old cell keys and stale, index-bound presentation meta, then install
  // the dense data. Old keys are removed before new ones are added, so a
  // remapped address can safely reuse an old address.
  for (const key in ws) {
    if (key.codePointAt(0) === 33) {
      if (
        key === "!merges" ||
        key === "!cols" ||
        key === "!rows" ||
        key === "!comments"
      ) {
        delete ws[key];
      }
      continue;
    }
    delete ws[key];
  }
  Object.assign(ws, newCells);
  if (newComments && Object.keys(newComments).length > 0) {
    ws["!comments"] = newComments;
  }
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length - 1, c: cols.length - 1 },
  });
}

/**
 * Replace each worksheet's declared `!ref` with a tight range covering only
 * real cells so `sheet_to_json` / `sheet_to_csv` walks are bounded by actual
 * data. Worksheets with no real cells lose `!ref` entirely so consumers emit
 * nothing rather than honoring a stale declared dimension.
 */
export function clampWorkbookToUsedRanges(
  workbook: XLSX.WorkBook,
  meta?: SpreadsheetBudgetMeta,
): void {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    compactWorksheet(worksheet, meta);
  }
}

/**
 * Parse a spreadsheet buffer with `sheetStubs` forced OFF and every sheet
 * clamped to its real used range. Stubs materialize placeholder objects for
 * valueless `<c>` elements physically present in the sheet XML (e.g.
 * style-only cells), bloating the cell map for no grading value; the real
 * explosion risk is downstream walks honoring a declared full-sheet `!ref`
 * (`A1:XFD1048576`), which the clamp removes. All spreadsheet parsing in
 * grading must go through this function.
 */
export function readClampedWorkbook(
  buffer: Buffer,
  options: XLSX.ParsingOptions & { FS?: string } = {},
  meta?: SpreadsheetBudgetMeta,
): XLSX.WorkBook {
  const workbook = XLSX.read(buffer, {
    ...options,
    type: "buffer",
    sheetStubs: false,
  });
  clampWorkbookToUsedRanges(workbook, meta);
  return workbook;
}
