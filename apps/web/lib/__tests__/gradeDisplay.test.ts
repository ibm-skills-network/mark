import { resolveStoreGrade } from "@/lib/gradeDisplay";

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
