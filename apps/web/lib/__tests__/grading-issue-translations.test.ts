/**
 * @jest-environment node
 */

import languages from "@/public/languages.json";
import { GRADING_ISSUE_SOURCE_STRINGS } from "@/lib/grading-issue-copy";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

// "Unable to grade" tells a learner exactly what to fix. In a language they
// don't read, that advice is as good as absent.
const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

const placeholders = (text: string) =>
  (text.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("unable-to-grade UI translations", () => {
  it("covers every supported language", () => {
    expect(translatedLanguages.length).toBeGreaterThan(0);
  });

  it.each(translatedLanguages)("has every string in %s", (languageCode) => {
    const catalog = getStaticUiTranslations(languageCode);
    const missing = GRADING_ISSUE_SOURCE_STRINGS.filter((source) => {
      const translation = catalog[normalizeSourceText(source)];
      return typeof translation !== "string" || translation.trim().length === 0;
    });

    expect(missing).toEqual([]);
  });

  it.each(translatedLanguages)(
    "keeps every placeholder in %s",
    (languageCode) => {
      const catalog = getStaticUiTranslations(languageCode);
      const broken = GRADING_ISSUE_SOURCE_STRINGS.filter((source) => {
        const translation = catalog[normalizeSourceText(source)];
        return (
          typeof translation === "string" &&
          placeholders(translation) !== placeholders(source)
        );
      });

      expect(broken).toEqual([]);
    },
  );
});
