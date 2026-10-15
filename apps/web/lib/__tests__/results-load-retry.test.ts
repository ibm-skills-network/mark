/**
 * @jest-environment node
 */

import { APIError, NetworkError } from "../api-client";
import {
  classifyResultsLoadFailure,
  hasAutomaticRetriesLeft,
  RESULTS_RETRY_DELAYS_MS,
  RESULTS_TROUBLE_SOURCE_STRINGS,
  resultsRetryDelayMs,
} from "../results-load-retry";
import languages from "@/public/languages.json";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

describe("classifyResultsLoadFailure", () => {
  // The /api proxy answers 500 when the API takes longer than 30s, so a slow
  // read of an attempt that exists arrives as a 500.
  it.each([500, 502, 503, 504, 408, 425, 429])("retries a %i", (status) => {
    expect(
      classifyResultsLoadFailure(new APIError("x", status, "failed")),
    ).toEqual({ kind: "http", status });
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "leaves a %i to its own screen",
    (status) => {
      expect(
        classifyResultsLoadFailure(new APIError("x", status, "failed")),
      ).toBeNull();
    },
  );

  it.each(["timeout", "unreachable", "interrupted"] as const)(
    "retries a request that got no response (%s)",
    (kind) => {
      expect(classifyResultsLoadFailure(new NetworkError("x", kind))).toEqual({
        kind: "network",
        networkKind: kind,
      });
    },
  );

  it("leaves an untyped failure alone unless the caller says it is untyped", () => {
    expect(classifyResultsLoadFailure(new Error("boom"))).toBeNull();
    expect(
      classifyResultsLoadFailure(new Error("Failed to fetch user"), {
        untypedFailuresAreRetryable: true,
      }),
    ).toEqual({ kind: "http", status: 500 });
    expect(
      classifyResultsLoadFailure(new TypeError("Failed to fetch"), {
        untypedFailuresAreRetryable: true,
      }),
    ).toEqual({ kind: "network", networkKind: "unreachable" });
  });

  it("still honours a status on an otherwise untyped failure", () => {
    expect(
      classifyResultsLoadFailure(new APIError("x", 401, "Unauthorized"), {
        untypedFailuresAreRetryable: true,
      }),
    ).toBeNull();
  });
});

describe("resultsRetryDelayMs", () => {
  it("backs off and stops after the scheduled retries", () => {
    const midpoint = () => 0.5;
    const delays = RESULTS_RETRY_DELAYS_MS.map((_, index) =>
      resultsRetryDelayMs(index, midpoint),
    );
    expect(delays).toEqual([...RESULTS_RETRY_DELAYS_MS]);
    for (let index = 1; index < delays.length; index++) {
      expect(delays[index]).toBeGreaterThan(delays[index - 1] ?? 0);
    }
    expect(resultsRetryDelayMs(RESULTS_RETRY_DELAYS_MS.length)).toBeNull();
    expect(hasAutomaticRetriesLeft(RESULTS_RETRY_DELAYS_MS.length)).toBe(false);
    expect(hasAutomaticRetriesLeft(0)).toBe(true);
  });

  it("spreads each delay by at most 20%", () => {
    const base = RESULTS_RETRY_DELAYS_MS[0];
    expect(resultsRetryDelayMs(0, () => 0)).toBe(Math.round(base * 0.8));
    expect(resultsRetryDelayMs(0, () => 1)).toBe(Math.round(base * 1.2));
  });
});

// Catalogs are keyed by exact English source text, so a new string is absent
// until someone adds it and a non-English learner reads it in English.
describe("results trouble screen UI translations", () => {
  const translatedLanguages = languages
    .map((language) => language.code)
    .filter((code) => code !== DEFAULT_UI_LANGUAGE);

  it.each(translatedLanguages)("has every string in %s", (languageCode) => {
    const catalog = getStaticUiTranslations(languageCode);
    const missing = RESULTS_TROUBLE_SOURCE_STRINGS.filter((source) => {
      const translation = catalog[normalizeSourceText(source)];
      return typeof translation !== "string" || translation.trim().length === 0;
    });

    expect(missing).toEqual([]);
  });
});
