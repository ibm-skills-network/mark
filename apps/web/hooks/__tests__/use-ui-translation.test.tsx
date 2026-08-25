import { renderHook } from "@testing-library/react";

const searchParams = { get: jest.fn().mockReturnValue(null) };
jest.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

jest.mock("@/lib/static-ui-translations", () => ({
  getStaticUiTranslations: (language: string) =>
    language === "fr"
      ? {
          "Please wait {time} before retrying":
            "Attendez {time} avant de réessayer",
        }
      : {},
  normalizeSourceText: (value: string) => value.replace(/\s+/g, " ").trim(),
}));

import { interpolate, useUiTranslation } from "../use-ui-translation";

describe("interpolate", () => {
  it("substitutes named placeholders", () => {
    expect(
      interpolate("Please wait {time} before retrying", { time: "4m 54s" }),
    ).toBe("Please wait 4m 54s before retrying");
  });

  it("leaves unknown placeholders untouched rather than blanking them", () => {
    expect(interpolate("Wait {time} then {other}", { time: "1m" })).toBe(
      "Wait 1m then {other}",
    );
  });

  it("accepts numbers", () => {
    expect(interpolate("{count} attempts", { count: 3 })).toBe("3 attempts");
  });

  it("returns the template unchanged when given no params", () => {
    expect(interpolate("No placeholders here")).toBe("No placeholders here");
  });
});

describe("useUiTranslation", () => {
  beforeEach(() => {
    searchParams.get.mockReturnValue(null);
    window.localStorage.clear();
  });

  it("interpolates the source string in the default language", () => {
    const { result } = renderHook(() => useUiTranslation());
    expect(
      result.current.t("Please wait {time} before retrying", {
        time: "4m 54s",
      }),
    ).toBe("Please wait 4m 54s before retrying");
  });

  it("uses the catalog translation, keeping the value in that language's word order", () => {
    searchParams.get.mockReturnValue("fr");
    const { result } = renderHook(() => useUiTranslation());
    expect(
      result.current.t("Please wait {time} before retrying", {
        time: "4m 54s",
      }),
    ).toBe("Attendez 4m 54s avant de réessayer");
  });

  // The safety property that makes converting a string a no-risk change: an
  // untranslated key renders exactly what the DOM translator would have left.
  it("falls back to the source string when the key is missing", () => {
    searchParams.get.mockReturnValue("fr");
    const { result } = renderHook(() => useUiTranslation());
    expect(result.current.t("Some unconverted string")).toBe(
      "Some unconverted string",
    );
  });
});

// Catalog keys are stored normalized, and RouteUiTranslator falls back to the
// normalized form when the raw string misses. The hook has to do the same or a
// string resolves on one path and not the other.
describe("useUiTranslation key normalization", () => {
  beforeEach(() => {
    searchParams.get.mockReturnValue("fr");
    window.localStorage.clear();
  });

  it("matches a catalog key when the source has irregular whitespace", () => {
    const { result } = renderHook(() => useUiTranslation());
    expect(
      result.current.t("Please wait   {time}\n  before retrying", {
        time: "4m 54s",
      }),
    ).toBe("Attendez 4m 54s avant de réessayer");
  });
});
