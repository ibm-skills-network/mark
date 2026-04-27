import { Logger } from "@nestjs/common";

import { resolveTimeoutSeconds } from "./lti-sync.module";

describe("resolveTimeoutSeconds", () => {
  it("returns the parsed positive integer for a valid value", () => {
    expect(resolveTimeoutSeconds("60", 30)).toBe(60);
  });

  it("returns the default when input is undefined", () => {
    expect(resolveTimeoutSeconds(undefined, 30)).toBe(30);
  });

  it("returns the default when input is empty string", () => {
    expect(resolveTimeoutSeconds("", 30)).toBe(30);
  });

  it("returns the default when input is whitespace-only", () => {
    expect(resolveTimeoutSeconds("   ", 30)).toBe(30);
  });

  it("returns the default and logs warn on non-numeric input", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    expect(resolveTimeoutSeconds("abc", 30, logger)).toBe(30);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("abc"));
  });

  it("returns the default and logs warn on zero", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    expect(resolveTimeoutSeconds("0", 30, logger)).toBe(30);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("returns the default and logs warn on negative", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    expect(resolveTimeoutSeconds("-5", 30, logger)).toBe(30);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('floors decimal input via parseInt ("60.7" → 60)', () => {
    expect(resolveTimeoutSeconds("60.7", 30)).toBe(60);
  });

  it("does not log warn when input is missing or empty (silent default)", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    resolveTimeoutSeconds(undefined, 30, logger);
    resolveTimeoutSeconds("", 30, logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
