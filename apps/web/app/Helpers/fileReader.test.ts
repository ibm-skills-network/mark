import * as XLSX from "xlsx";
import { readExcel, workbookToSheetData } from "./fileReader";

// fileReader.ts imports several ESM-only modules at module scope (react-pdftotext
// pulls in an ESM pdfjs-dist build; remark ships pure ESM) that jest's transform
// chain cannot parse. The Excel paths exercised here never touch those readers,
// so stub the modules out to keep the import side of fileReader.ts loadable.
jest.mock("react-pdftotext", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("remark", () => ({
  __esModule: true,
  remark: jest.fn(),
}));

describe("workbookToSheetData", () => {
  it("bounds output for a workbook with a formal full-sheet !ref", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Qty", "Price"],
      ["Widget", 3, 4.5],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    // Mirror a production XLSX with a formal `dimension` attribute, without
    // paying the cost of writing a 17-billion-cell sheet.
    wb.Sheets["Inventory"]["!ref"] = "A1:XFD1048576";

    const result = workbookToSheetData(wb);

    expect(result).toHaveLength(1);
    expect(result[0].sheetName).toBe("Inventory");
    // Pre-fix this is ~1,048,576 row arrays.
    expect(result[0].data).toHaveLength(2);
    expect(result[0].data[0]).toEqual(["Item", "Qty", "Price"]);
    expect(result[0].data[1]).toEqual(["Widget", 3, 4.5]);
  }, 15_000);

  it("returns no rows for an empty worksheet with a stale declared range", () => {
    const ws: XLSX.WorkSheet = { "!ref": "A1:Z100" };
    const wb: XLSX.WorkBook = { SheetNames: ["Empty"], Sheets: { Empty: ws } };

    const result = workbookToSheetData(wb);

    expect(result[0].data).toEqual([]);
  });

  it("bounds output when a styled-empty cell sits far below the data", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
    ]);
    ws["J5000"] = { t: "z", z: "0.00" };
    ws["!ref"] = "A1:J5000";
    XLSX.utils.book_append_sheet(wb, ws, "Results");

    const result = workbookToSheetData(wb);

    expect(result[0].data).toHaveLength(2);
  });
});

describe("readExcel", () => {
  it("parses a small file end-to-end into bounded sheet JSON", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const data = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const file = new File([data], "results.xlsx");

    const result = await readExcel(file, 7);

    expect(result.filename).toBe("results.xlsx");
    expect(result.questionId).toBe(7);
    const parsed = JSON.parse(result.content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sheetName).toBe("Results");
    expect(parsed[0].data).toEqual([
      ["Name", "Score"],
      ["Alice", 90],
    ]);
  });
});
