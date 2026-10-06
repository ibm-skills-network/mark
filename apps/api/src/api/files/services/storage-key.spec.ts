import {
  buildContentDisposition,
  displayNameFromStorageKey,
  generateStorageKeyId,
  stripStorageKeyPrefix,
} from "./storage-key";

describe("storage key helpers", () => {
  it("round-trips a generated id through the prefix stripper", () => {
    for (let index = 0; index < 200; index++) {
      const name = `${generateStorageKeyId()}-report.xlsx`;
      expect(stripStorageKeyPrefix(name)).toBe("report.xlsx");
    }
  });

  it("leaves names without a Mark prefix untouched", () => {
    expect(stripStorageKeyPrefix("report.xlsx")).toBe("report.xlsx");
    expect(stripStorageKeyPrefix("final-report.xlsx")).toBe(
      "final-report.xlsx",
    );
    expect(stripStorageKeyPrefix("00000000abcdefghij-report.xlsx")).toBe(
      "00000000abcdefghij-report.xlsx",
    );
  });

  it("derives the original upload name from a full storage key", () => {
    expect(
      displayNameFromStorageKey(
        "2537/learner@example.com/26293/munx8fz6ywtb03w6lm-Montgomery_END.XLSX",
      ),
    ).toBe("Montgomery_END.XLSX");
    expect(displayNameFromStorageKey("author/notes.txt")).toBe("notes.txt");
  });

  it("builds an ASCII-safe header with an RFC 5987 UTF-8 name", () => {
    expect(buildContentDisposition("attachment", "report.xlsx")).toBe(
      `attachment; filename="report.xlsx"; filename*=UTF-8''report.xlsx`,
    );
    expect(buildContentDisposition("inline", 'a"b\\c\r\nd.txt')).toBe(
      `inline; filename="a_b_c__d.txt"; filename*=UTF-8''a%22b%5Cc%0D%0Ad.txt`,
    );
    expect(buildContentDisposition("attachment", "résumé (1).pdf")).toBe(
      `attachment; filename="r_sum_ (1).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.pdf`,
    );
  });

  it("falls back to a generic name when nothing usable remains", () => {
    expect(buildContentDisposition("attachment", "")).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    );
  });
});
