import * as XLSX from "xlsx";
import {
  clampWorkbookToUsedRanges,
  computeUsedRange,
  readClampedWorkbook,
} from "./spreadsheet-used-range.utils";

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

describe("readClampedWorkbook", () => {
  it("parses a real buffer round-trip with tight ranges", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );

    const parsed = readClampedWorkbook(buffer, {
      cellText: true,
      cellDates: true,
    });

    expect(parsed.SheetNames).toEqual(["Results"]);
    expect(parsed.Sheets["Results"]["!ref"]).toBe("A1:B2");
  });

  it("forces sheetStubs off even when a caller asks for them", () => {
    const wb = XLSX.utils.book_new();
    // A styled-but-empty B1 (between A1 and C1) persists in the written XLSX
    // XML as a valueless <c> element. With stubs on, parsing the file would
    // materialize a type-"z" placeholder at B1; with stubs off it is dropped.
    const ws = XLSX.utils.aoa_to_sheet([["left", null, "right"]]);
    ws["B1"] = { t: "z", z: "0.00" };
    XLSX.utils.book_append_sheet(wb, ws, "Gaps");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }),
    );

    const parsed = readClampedWorkbook(buffer, { sheetStubs: true });

    const sheet = parsed.Sheets["Gaps"];
    for (const key in sheet) {
      if (key.charCodeAt(0) === 33) continue; // '!' meta key
      expect(sheet[key].t).not.toBe("z");
    }
  });

  it("passes the FS delimiter through for tab-separated text", () => {
    const buffer = Buffer.from("Name\tScore\nAlice\t90\n", "utf8");

    const parsed = readClampedWorkbook(buffer, { FS: "\t" });

    const sheetName = parsed.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(parsed.Sheets[sheetName], {
      header: 1,
    }) as unknown[][];
    expect(rows[0]).toEqual(["Name", "Score"]);
  });

  it("clamps past styled-empty cells on a real cellStyles round-trip", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
    ]);
    ws["J5000"] = { t: "z", z: "0.00" };
    ws["!ref"] = "A1:J5000";
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }),
    );

    const parsed = readClampedWorkbook(buffer, { cellStyles: true });

    expect(parsed.Sheets["Results"]["!ref"]).toBe("A1:B2");
    const rows = XLSX.utils.sheet_to_json(parsed.Sheets["Results"], {
      header: 1,
    }) as unknown[][];
    expect(rows).toHaveLength(2);
  });
});
