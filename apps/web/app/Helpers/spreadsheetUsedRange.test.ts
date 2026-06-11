import * as XLSX from "xlsx";
import {
  clampWorkbookToUsedRanges,
  computeUsedRange,
} from "./spreadsheetUsedRange";

describe("computeUsedRange", () => {
  it("returns the tight bounding box of real cells", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Qty", "Price"],
      ["Widget", 3, 4.5],
      ["Gadget", 1, 12.25],
    ]);

    const range = computeUsedRange(ws);

    expect(range).toEqual({ s: { r: 0, c: 0 }, e: { r: 2, c: 2 } });
  });

  it("returns null for a worksheet with no real cells", () => {
    const ws: XLSX.WorkSheet = { "!ref": "A1:Z100" };

    expect(computeUsedRange(ws)).toBeNull();
  });

  it("ignores style-only placeholder cells when computing the range", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
    ]);
    // Direct-formatting an empty cell far below the data is a common
    // real-world pattern; with cellStyles on it parses as a t:"z" stub
    // even when sheetStubs is off.
    ws["J5000"] = { t: "z", z: "0.00" };
    ws["!ref"] = "A1:J5000";

    const range = computeUsedRange(ws);

    expect(range).toEqual({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } });
  });
});

describe("clampWorkbookToUsedRanges", () => {
  // With the bug present, downstream sheet_to_json over a full-sheet !ref
  // hangs the worker. A per-test timeout converts that into a deterministic
  // Jest failure.
  it("replaces a formal full-sheet !ref with the real used range", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Qty", "Price"],
      ["Widget", 3, 4.5],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    // Mirror what a production XLSX with a formal `dimension` attribute
    // looks like after parse, without writing a 17-billion-cell sheet.
    wb.Sheets["Inventory"]["!ref"] = "A1:XFD1048576";

    clampWorkbookToUsedRanges(wb);

    expect(wb.Sheets["Inventory"]["!ref"]).toBe("A1:C2");
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Inventory"], {
      header: 1,
    });
    expect(rows.length).toBeLessThan(10);
  }, 15_000);

  it("drops !ref entirely on a sheet with a stale dimension and no cells", () => {
    const ws: XLSX.WorkSheet = { "!ref": "A1:Z100" };
    const wb: XLSX.WorkBook = { SheetNames: ["Empty"], Sheets: { Empty: ws } };

    clampWorkbookToUsedRanges(wb);

    expect(wb.Sheets["Empty"]["!ref"]).toBeUndefined();
    expect(XLSX.utils.sheet_to_json(ws, { header: 1 })).toEqual([]);
  });
});
