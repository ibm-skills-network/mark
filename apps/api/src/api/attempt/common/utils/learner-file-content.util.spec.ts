import {
  MAX_COERCED_FILE_CONTENT_LENGTH,
  normalizeLearnerFileContent,
} from "./learner-file-content.util";

describe("normalizeLearnerFileContent", () => {
  it("keeps string content as is", () => {
    expect(normalizeLearnerFileContent("InCos")).toEqual({
      content: "InCos",
      originalType: "string",
    });
    expect(normalizeLearnerFileContent("print(1)")).toEqual({
      content: "print(1)",
      originalType: "string",
    });
  });

  it("leaves missing content missing", () => {
    expect(normalizeLearnerFileContent(undefined)).toEqual({
      content: undefined,
      originalType: "undefined",
    });
    expect(normalizeLearnerFileContent(null)).toEqual({
      content: undefined,
      originalType: "null",
    });
  });

  it("serializes a parsed notebook object back to its JSON text", () => {
    const notebook = { cells: [{ cell_type: "code", source: ["x = 1"] }] };
    const result = normalizeLearnerFileContent(notebook);
    expect(result.originalType).toBe("object");
    expect(typeof result.content).toBe("string");
    expect(JSON.parse(result.content as string)).toEqual(notebook);
  });

  it("serializes a parsed JSON array", () => {
    const result = normalizeLearnerFileContent([{ a: 1 }]);
    expect(result).toEqual({ content: '[{"a":1}]', originalType: "array" });
  });

  it("turns primitives into their text", () => {
    expect(normalizeLearnerFileContent(42).content).toBe("42");
    expect(normalizeLearnerFileContent(true).content).toBe("true");
  });

  it("rejects serialized content over the size bound", () => {
    const huge = { blob: "x".repeat(MAX_COERCED_FILE_CONTENT_LENGTH) };
    expect(() => normalizeLearnerFileContent(huge)).toThrow(/too large/i);
  });
});
