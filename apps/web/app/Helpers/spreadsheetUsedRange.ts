import * as XLSX from "xlsx";

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

/**
 * Replace each worksheet's declared `!ref` with a tight range covering only
 * real cells so `sheet_to_json` walks are bounded by actual data. Worksheets
 * with no real cells lose `!ref` entirely so consumers emit nothing rather
 * than honoring a stale declared dimension.
 */
export function clampWorkbookToUsedRanges(workbook: XLSX.WorkBook): void {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const tightRange = computeUsedRange(worksheet);
    if (tightRange) {
      worksheet["!ref"] = XLSX.utils.encode_range(tightRange);
    } else {
      delete worksheet["!ref"];
    }
  }
}
