import { BadRequestException } from "@nestjs/common";
import { sanitizeUploadPath } from "./path-sanitizer";

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
