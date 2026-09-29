import { formatShortDuration } from "../format-duration";

describe("formatShortDuration", () => {
  it("formats all four units in English", () => {
    expect(formatShortDuration(2 * 86_400 + 3 * 3600 + 4 * 60 + 5, "en")).toBe(
      "2d 3h 4m 5s",
    );
  });

  it("drops zero-valued units", () => {
    expect(formatShortDuration(3600, "en")).toBe("1h");
    expect(formatShortDuration(61, "en")).toBe("1m 1s");
  });

  it("keeps seconds as the only unit for sub-minute durations", () => {
    expect(formatShortDuration(9, "en")).toBe("9s");
    expect(formatShortDuration(0, "en")).toBe("0s");
  });

  it("does not truncate at a day boundary", () => {
    expect(formatShortDuration(26 * 3600, "en")).toBe("1d 2h");
  });

  it("localizes the unit labels rather than hardcoding English suffixes", () => {
    // Exact narrow forms vary by ICU version, so assert the property that
    // matters: the French day unit is "j", not the English "d".
    expect(formatShortDuration(2 * 86_400, "fr")).toContain("j");
  });
});
