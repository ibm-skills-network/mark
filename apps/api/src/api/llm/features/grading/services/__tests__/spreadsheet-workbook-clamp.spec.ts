/**
 * Regression coverage for spreadsheet parsing inside grading: the workbook
 * loaded for spreadsheet metrics must never materialize stub cells or honor
 * a declared full-sheet dimension. A workbook parsed with stubs on would
 * turn every later sheet walk (metrics, sheet_to_json) into a memory bomb.
 */
import * as XLSX from "xlsx";

function buildService() {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const service = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../file-grading.service").FileGradingService.prototype,
  );
  service.logger = mockLogger;

  return { service, mockLogger };
}

describe("FileGradingService.loadSpreadsheetWorkbook", () => {
  it("returns a workbook with stubs off and !ref clamped to real cells", async () => {
    const wb = XLSX.utils.book_new();
    // Styled-but-empty B1: written with cellStyles, the empty <c> element is
    // physically present in the sheet XML, so a stubs-on parse materializes
    // a type-"z" placeholder there. (Gap cells and blank rows do NOT survive
    // a write round-trip as stub candidates in SheetJS 0.20.2.)
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", null, "Price"],
      ["Widget", 3, 4.5],
    ]);
    ws["B1"] = { t: "z", z: "0.00" };
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }),
    );

    const { service } = buildService();
    service.fetchFileBuffer = jest.fn().mockResolvedValue(buffer);

    const result = await service.loadSpreadsheetWorkbook([
      { filename: "inventory.xlsx", content: "InCos" },
    ]);

    expect(result).not.toBeNull();
    expect(result.filename).toBe("inventory.xlsx");

    const sheet = result.workbook.Sheets["Sheet1"];
    expect(sheet["!ref"]).toBe("A1:C2");
    for (const key in sheet) {
      if (key.charCodeAt(0) === 33) continue; // '!' meta key
      expect(sheet[key].t).not.toBe("z");
    }
  });

  it("still skips files that are not spreadsheets", async () => {
    const { service } = buildService();
    service.fetchFileBuffer = jest.fn();

    const result = await service.loadSpreadsheetWorkbook([
      { filename: "essay.pdf", content: "InCos" },
    ]);

    expect(result).toBeNull();
    expect(service.fetchFileBuffer).not.toHaveBeenCalled();
  });
});
