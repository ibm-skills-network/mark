import { resolvePassedIndicator } from "./pass-fail.util";

describe("resolvePassedIndicator", () => {
  it("returns undefined when the indicator is disabled", () => {
    expect(resolvePassedIndicator(false, 0.9, 75)).toBeUndefined();
    expect(resolvePassedIndicator(undefined, 0.9, 75)).toBeUndefined();
    expect(resolvePassedIndicator(null, 0.9, 75)).toBeUndefined();
  });

  it("returns undefined when the attempt has no grade", () => {
    expect(resolvePassedIndicator(true, null, 75)).toBeUndefined();
    expect(resolvePassedIndicator(true, undefined, 75)).toBeUndefined();
  });

  it("compares the 0-1 grade against the percentage passing grade", () => {
    expect(resolvePassedIndicator(true, 0.6, 75)).toBe(false);
    expect(resolvePassedIndicator(true, 0.75, 75)).toBe(true);
    expect(resolvePassedIndicator(true, 0.8, 75)).toBe(true);
  });

  it("treats a grade of 0 as a real failing grade", () => {
    expect(resolvePassedIndicator(true, 0, 50)).toBe(false);
  });

  it("passes at exactly the boundary", () => {
    expect(resolvePassedIndicator(true, 0.5, 50)).toBe(true);
  });

  it("defaults the passing grade to 50 when unset", () => {
    expect(resolvePassedIndicator(true, 0.5, null)).toBe(true);
    expect(resolvePassedIndicator(true, 0.49, undefined)).toBe(false);
  });
});
