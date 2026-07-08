import * as XLSX from "xlsx";
import {
  clampWorkbookToUsedRanges,
  compactWorksheet,
  computeUsedRange,
  readClampedWorkbook,
} from "./spreadsheet-used-range.utils";
import { OversizedSubmissionError } from "../errors/oversized-submission.error";

// Build a worksheet object directly (never round-trip a full-grid !ref through
// disk — that is itself a SheetJS memory bomb).
function ws(
  cells: Record<string, string | number>,
  ref: string,
): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  for (const [addr, v] of Object.entries(cells)) {
    sheet[addr] =
      typeof v === "number" ? { t: "n", v, w: String(v) } : { t: "s", v, w: v };
  }
  sheet["!ref"] = ref; // declared dimension (possibly bloated)
  return sheet;
}
function csvLines(sheet: XLSX.WorkSheet): string[] {
  return XLSX.utils
    .sheet_to_csv(sheet, { blankrows: true, FS: "\t" })
    .split("\n")
    .filter((l) => l !== "");
}

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

describe("compactWorksheet", () => {
  it("leaves contiguous, unpruned data unchanged (phantom dimension → tight box)", () => {
    const sheet = ws({ A1: "h1", B1: "h2", A2: "x", B2: "y" }, "A1:XFD1048576");
    compactWorksheet(sheet);
    expect(sheet["!ref"]).toBe("A1:B2");
    expect(sheet["A1"]).toBeDefined();
    expect(sheet["B2"]).toBeDefined();
  });

  it("compacts a bottom-outlier total without spanning the gap", () => {
    // header + 1 data row + grand total parked in the last grid row.
    const sheet = ws(
      { A1: "name", B1: "qty", A2: "widget", B2: 5, B1048576: 5 },
      "A1:XFD1048576",
    );
    compactWorksheet(sheet);
    // 3 populated rows (1, 2, 1048576) collapse to rows 1..3; cols A,B.
    expect(sheet["!ref"]).toBe("A1:B3");
    expect(csvLines(sheet).length).toBe(3);
  });

  it("prunes empty auto-header columns from a full-grid table", () => {
    // header cell in a far column (no data below it) must be dropped.
    const sheet = ws(
      { A1: "real", B1: "real2", ZZ1: "autoheader", A2: "v1", B2: "v2" },
      "A1:XFD1048576",
    );
    compactWorksheet(sheet);
    expect(sheet["!ref"]).toBe("A1:B2"); // ZZ pruned (no data below header)
  });

  it("falls back to all populated columns for a header-only sheet", () => {
    const sheet = ws({ A1: "h1", B1: "h2", C1: "h3" }, "A1:XFD1048576");
    compactWorksheet(sheet);
    expect(sheet["!ref"]).toBe("A1:C1");
  });

  it("collapses non-contiguous columns to a dense range", () => {
    const sheet = ws({ A1: "a", C1: "c", A2: "1", C2: "3" }, "A1:XFD1048576");
    compactWorksheet(sheet);
    expect(sheet["!ref"]).toBe("A1:B2"); // cols A,C → A,B
    expect(csvLines(sheet)[0]).toBe("a\tc");
  });

  it("rejects when populated rows exceed the evidence-block budget", () => {
    const sheet: XLSX.WorkSheet = { "!ref": "A1:A1048576" };
    for (let r = 0; r < 60_000; r += 1)
      sheet[`A${r + 1}`] = { t: "n", v: r, w: String(r) };
    expect(() => compactWorksheet(sheet, { filename: "big.xlsx" })).toThrow(
      OversizedSubmissionError,
    );
  });

  it("drops !ref for an empty sheet", () => {
    const sheet: XLSX.WorkSheet = { "!ref": "A1:XFD1048576" };
    compactWorksheet(sheet);
    expect(sheet["!ref"]).toBeUndefined();
  });
});
