import { MAX_LANG_LENGTH, normalizeLangQuery } from "./query-language";

describe("normalizeLangQuery", () => {
  it("keeps a plain code, trimmed", () => {
    expect(normalizeLangQuery(" zh-cn ")).toBe("zh-cn");
  });

  it("uses the first value of a repeated parameter", () => {
    expect(normalizeLangQuery(["fr", "de"])).toBe("fr");
  });

  it("treats non-strings, empty and oversized values as absent", () => {
    expect(normalizeLangQuery(undefined)).toBeUndefined();
    expect(normalizeLangQuery({ a: "fr" })).toBeUndefined();
    expect(normalizeLangQuery([])).toBeUndefined();
    expect(normalizeLangQuery([["fr"]])).toBeUndefined();
    expect(normalizeLangQuery("  ")).toBeUndefined();
    expect(normalizeLangQuery("x".repeat(MAX_LANG_LENGTH + 1))).toBeUndefined();
  });
});
