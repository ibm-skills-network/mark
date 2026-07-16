import {
  resolveMissingGradeReason,
  resolveStoreGrade,
} from "@/lib/gradeDisplay";

describe("resolveMissingGradeReason", () => {
  it("reports score-hidden when the author disabled the assignment score", () => {
    expect(resolveMissingGradeReason(false)).toBe("score-hidden");
  });

  it("reports results-missing when the score is visible (grade was lost, e.g. preview reload)", () => {
    expect(resolveMissingGradeReason(true)).toBe("results-missing");
  });

  it("reports results-missing when visibility is unknown (no persisted assignment details)", () => {
    expect(resolveMissingGradeReason(undefined)).toBe("results-missing");
  });
});

describe("resolveStoreGrade", () => {
  it("passes a numeric grade through", () => {
    expect(resolveStoreGrade(87)).toBe(87);
  });

  it("passes a genuine 0% grade through", () => {
    expect(resolveStoreGrade(0)).toBe(0);
  });

  it("maps a null grade (never provided) to NaN so the hidden-score view renders", () => {
    expect(Number.isNaN(resolveStoreGrade(null))).toBe(true);
  });

  it("maps an undefined grade to NaN so the hidden-score view renders", () => {
    expect(Number.isNaN(resolveStoreGrade(undefined))).toBe(true);
  });
});
