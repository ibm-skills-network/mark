import { BadRequestException } from "@nestjs/common";
import { sanitizeUploadFileName, sanitizeUploadPath } from "./path-sanitizer";

describe("sanitizeUploadPath", () => {
  describe("accepts valid input", () => {
    it.each([
      ["undefined", undefined, ""],
      ["null", null, ""],
      ["empty string", "", ""],
      ["plain path", "subdir", "subdir"],
      ["leading slash stripped", "/subdir", "subdir"],
      ["nested", "a/b/c", "a/b/c"],
      ["self ref collapsed", "a/./b", "a/b"],
    ] as const)("accepts %s", (_, input, expected) => {
      expect(sanitizeUploadPath(input as string | undefined | null)).toBe(
        expected,
      );
    });
  });

  describe("rejects path traversal", () => {
    it.each([
      ["bare traversal", ".."],
      ["nested traversal", "../authors/admin"],
      ["multi traversal", "../../authors/admin"],
      ["embedded traversal", "a/../../b"],
      ["absolute traversal", "/../etc/passwd"],
    ])("rejects %s with BadRequestException", (_, input) => {
      expect(() => sanitizeUploadPath(input)).toThrow(BadRequestException);
    });
  });

  describe("rejects null-byte injection", () => {
    it.each([
      ["null byte alone", "abc\0def"],
      ["null byte with traversal", "..\0/abc"],
    ])("rejects %s with BadRequestException", (_, input) => {
      expect(() => sanitizeUploadPath(input)).toThrow(BadRequestException);
    });
  });

  describe("rejects mixed-separator bypass (Windows-style)", () => {
    it.each([
      ["backslash-traversal", "..\\..\\authors"],
      ["mixed forward+back", "foo/..\\bar"],
    ])("rejects %s with BadRequestException", (_, input) => {
      expect(() => sanitizeUploadPath(input)).toThrow(BadRequestException);
    });
  });

  describe("rejects non-string types (direct-upload bypasses class-validator)", () => {
    it.each([
      ["array", ["..", ".."]],
      ["number", 42],
      ["object", { malicious: true }],
      ["boolean", true],
    ])("rejects %s with BadRequestException", (_, input) => {
      expect(() => sanitizeUploadPath(input as unknown as string)).toThrow(
        BadRequestException,
      );
    });
  });

  describe("error message is generic (no field-leak)", () => {
    it("throws with message 'Invalid upload path' for `..`", () => {
      expect(() => sanitizeUploadPath("..")).toThrow("Invalid upload path");
    });
    it("throws with message 'Invalid upload path' for null byte", () => {
      try {
        sanitizeUploadPath("\0");
        throw new Error("expected throw");
      } catch (e) {
        expect((e as Error).message).toBe("Invalid upload path");
      }
    });
    it("throws with message 'Invalid upload path' for non-string", () => {
      try {
        sanitizeUploadPath(42 as unknown as string);
        throw new Error("expected throw");
      } catch (e) {
        expect((e as Error).message).toBe("Invalid upload path");
      }
    });
  });
});

describe("sanitizeUploadFileName", () => {
  it.each([
    ["report.pdf", "report.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\essay.docx", "essay.docx"],
    ["dir/sub/notes.md", "notes.md"],
    ["bad\u0000name\u001F.txt", "badname.txt"],
    ["tab\tand\nnewline.py", "tabandnewline.py"],
    ["  spaced.txt  ", "spaced.txt"],
  ])("reduces %j to %j", (input, expected) => {
    expect(sanitizeUploadFileName(input)).toBe(expected);
  });

  it.each([
    ["an empty name", ""],
    ["a trailing separator", "folder/"],
    ["only control characters", "\u0001\u0002"],
    ["a dot segment", "a/.."],
    ["a name over 255 characters", `${"x".repeat(252)}.pdf`],
    ["a non-string", 42],
  ])("rejects %s with a generic 400", (_label, input) => {
    expect(() => sanitizeUploadFileName(input)).toThrow(BadRequestException);
    expect(() => sanitizeUploadFileName(input)).toThrow("Invalid file name");
  });
});
