import { filenamesMatch } from "./spreadsheet-rubric.utils";

const EXPECTED = "Montgomery_Fleet_Equipment_Inventory_FA_PART_1_END.XLSX";
const BASE = "Montgomery_Fleet_Equipment_Inventory_FA_PART_1_END";

function storagePrefix(at: Date): string {
  return `${at.getTime().toString(36)}ywtb03w6lm-`;
}

describe("filenamesMatch", () => {
  it.each([
    `${BASE}.XLSX`,
    `${BASE}.xlsx`,
    `  ${BASE}.xlsx  `,
    `C:\\Users\\me\\Downloads\\${BASE}.xlsx`,
  ])("accepts the exact name ignoring case and path: %s", (actual) => {
    expect(filenamesMatch(actual, EXPECTED)).toBe(true);
  });

  it.each([
    `${BASE}.XLSX.xlsx`,
    `${BASE}.xlsx.xlsx`,
    `${BASE}.XLSX.XLSX`,
    `${BASE}.XLSX..xlsx`,
    `${BASE}..xlsx`,
  ])("accepts a duplicated extension: %s", (actual) => {
    expect(filenamesMatch(actual, EXPECTED)).toBe(true);
  });

  it.each([
    `${BASE} (1).xlsx`,
    `${BASE} (1).XLSX`,
    `${BASE} (12).xlsx`,
    `${BASE}(2).XLSX`,
    `${BASE}.XLSX (1).xlsx`,
  ])("accepts a browser duplicate-download suffix: %s", (actual) => {
    expect(filenamesMatch(actual, EXPECTED)).toBe(true);
  });

  it("accepts a name carrying Mark's own storage-key prefix", () => {
    const prefix = storagePrefix(new Date("2026-09-20T10:00:00Z"));
    expect(filenamesMatch(`${prefix}${BASE}.xlsx`, EXPECTED)).toBe(true);
    expect(filenamesMatch(`${prefix}${BASE}.XLSX (1).xlsx`, EXPECTED)).toBe(
      true,
    );
  });

  it("accepts real prefixed names seen in production", () => {
    expect(
      filenamesMatch(
        "munx8fz6ywtb03w6lm-Montgomery_Fleet_Equipment_Inventory_FA_PART_1_END.xlsx",
        EXPECTED,
      ),
    ).toBe(true);
    expect(
      filenamesMatch(
        "muk0spnrdsbbar5drm5-Montgomery_Fleet_Equipment_Inventory_FA_PART_1_END.XLSX (1).xlsx",
        EXPECTED,
      ),
    ).toBe(true);
  });

  it.each([
    `${BASE}.csv`,
    `${BASE}.XLSX.csv`,
    `${BASE}.csv.xlsx`,
    `${BASE}.xls`,
    "Montgomery_Fleet_Equipment_Inventory_FA_PART_1_START.xlsx",
    "Montgomery_Fleet_Equipment_Inventory_FA_PART_1_START (1).xlsx",
    `${BASE}1.xlsx`,
    `${BASE}-3.XLSX`,
    `${BASE} 1.xlsx`,
    `${BASE} copy.xlsx`,
    `${BASE} (1a).xlsx`,
    `${BASE}.XLSX.xlsx.zip`,
    "Montgomery_Fleet_Inventory_FA_Part_1_END.XLSX",
    "1.xlsx",
    "",
  ])("rejects a different name: %s", (actual) => {
    expect(filenamesMatch(actual, EXPECTED)).toBe(false);
  });

  it("rejects an arbitrary prefix that is not a Mark storage key", () => {
    expect(filenamesMatch(`final-${BASE}.xlsx`, EXPECTED)).toBe(false);
    expect(filenamesMatch(`mynewversion2-${BASE}.xlsx`, EXPECTED)).toBe(false);
    // Right shape, but the timestamp part decodes to a date long before uploads existed.
    expect(filenamesMatch(`00000000abcdefghij-${BASE}.xlsx`, EXPECTED)).toBe(
      false,
    );
  });

  it("rejects a storage-key prefix with a future timestamp", () => {
    const future = storagePrefix(new Date(Date.now() + 30 * 86_400_000));
    expect(filenamesMatch(`${future}${BASE}.xlsx`, EXPECTED)).toBe(false);
  });

  it("does not let the prefix or suffix rules match a different base name", () => {
    const prefix = storagePrefix(new Date("2026-09-20T10:00:00Z"));
    expect(
      filenamesMatch(
        `${prefix}Montgomery_Fleet_Equipment_Inventory_FA_PART_1_START (1).xlsx`,
        EXPECTED,
      ),
    ).toBe(false);
  });

  it("still requires an expected filename", () => {
    expect(filenamesMatch(`${BASE}.xlsx`, "")).toBe(false);
  });
});
