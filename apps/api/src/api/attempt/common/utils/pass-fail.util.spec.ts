import { meetsPassingGrade, resolvePassedIndicator } from "./pass-fail.util";

describe("meetsPassingGrade", () => {
  it("compares the 0-1 grade against the percentage passing grade", () => {
    expect(meetsPassingGrade(0.6, 75)).toBe(false);
    expect(meetsPassingGrade(0.75, 75)).toBe(true);
  });

  it("never passes an ungraded attempt", () => {
    expect(meetsPassingGrade(null, 75)).toBe(false);
    expect(meetsPassingGrade(undefined, 75)).toBe(false);
  });

  it("passes at boundaries that are not exact in binary floating point", () => {
    expect(meetsPassingGrade(29 / 100, 29)).toBe(true);
    expect(meetsPassingGrade(57 / 100, 57)).toBe(true);
  });

  it("defaults the passing grade to 50 when unset", () => {
    expect(meetsPassingGrade(0.5, null)).toBe(true);
    expect(meetsPassingGrade(0.49, undefined)).toBe(false);
  });
});

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

  // 0.29 * 100 is 28.999999999999996, so scaling the grade up instead of the
  // threshold down fails a learner who scored exactly the passing grade.
  it("passes at boundaries that are not exact in binary floating point", () => {
    expect(resolvePassedIndicator(true, 29 / 100, 29)).toBe(true);
    expect(resolvePassedIndicator(true, 58 / 200, 29)).toBe(true);
    expect(resolvePassedIndicator(true, 57 / 100, 57)).toBe(true);
    expect(resolvePassedIndicator(true, 29 / 50, 58)).toBe(true);
  });

  it("still fails a grade one point below an inexact boundary", () => {
    expect(resolvePassedIndicator(true, 28 / 100, 29)).toBe(false);
    expect(resolvePassedIndicator(true, 56 / 100, 57)).toBe(false);
  });

  it("defaults the passing grade to 50 when unset", () => {
    expect(resolvePassedIndicator(true, 0.5, null)).toBe(true);
    expect(resolvePassedIndicator(true, 0.49, undefined)).toBe(false);
  });
});
