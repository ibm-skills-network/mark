/**
 * @jest-environment node
 */

import { CONNECTION_PROBLEM_SOURCE_STRINGS } from "@/components/ConnectionProblem";
import languages from "@/public/languages.json";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

// The catalogs are keyed by exact English source text, so a new string is
// simply absent until someone adds it — and a non-English learner reads it in
// English with no warning anywhere. This screen only ever appears when
// something has already gone wrong for that learner, which is the worst moment
// to switch them back into a language they may not read.
const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

describe("ConnectionProblem UI translations", () => {
  it("covers every supported language", () => {
    expect(translatedLanguages.length).toBeGreaterThan(0);
  });

  it.each(translatedLanguages)("has every string in %s", (languageCode) => {
    const catalog = getStaticUiTranslations(languageCode);
    const missing = CONNECTION_PROBLEM_SOURCE_STRINGS.filter((source) => {
      const translation = catalog[normalizeSourceText(source)];
      return typeof translation !== "string" || translation.trim().length === 0;
    });

    expect(missing).toEqual([]);
  });
});
