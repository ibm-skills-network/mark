/**
 * @jest-environment node
 */

import { YOUR_LEARNING_SYNC_SOURCE_STRINGS } from "@/components/GradeSyncStatus";
import languages from "@/public/languages.json";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

// Catalogs are keyed by exact English source text, so editing the notice copy
// silently drops its translations unless the catalogs change with it.
const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

describe("yourLearning sync notice UI translations", () => {
  it("covers every supported language", () => {
    expect(translatedLanguages.length).toBeGreaterThan(0);
  });

  it.each(translatedLanguages)("has every string in %s", (languageCode) => {
    const catalog = getStaticUiTranslations(languageCode);
    const missing = YOUR_LEARNING_SYNC_SOURCE_STRINGS.filter((source) => {
      const translation = catalog[normalizeSourceText(source)];
      return typeof translation !== "string" || translation.trim().length === 0;
    });

    expect(missing).toEqual([]);
  });
});
