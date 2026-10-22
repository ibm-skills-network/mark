/**
 * @jest-environment node
 */

import { IN_APP_BROWSER_UPLOAD_NOTICE_SOURCE_STRINGS } from "@/app/learner/(components)/Question/InAppBrowserUploadNotice";
import languages from "@/public/languages.json";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";
import { SUBMIT_WARNING_SOURCE_STRINGS } from "@/lib/utils";

// These strings tell a learner that their file is not going to be submitted.
// Shown in English to someone who does not read it, the warning is as good as
// absent — which is the failure it exists to prevent.
const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

const SOURCES = [
  ...IN_APP_BROWSER_UPLOAD_NOTICE_SOURCE_STRINGS,
  ...SUBMIT_WARNING_SOURCE_STRINGS,
];

const placeholders = (text: string) =>
  (text.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("upload guidance UI translations", () => {
  it("covers every supported language", () => {
    expect(translatedLanguages.length).toBeGreaterThan(0);
  });

  it.each(translatedLanguages)("has every string in %s", (languageCode) => {
    const catalog = getStaticUiTranslations(languageCode);
    const missing = SOURCES.filter((source) => {
      const translation = catalog[normalizeSourceText(source)];
      return typeof translation !== "string" || translation.trim().length === 0;
    });

    expect(missing).toEqual([]);
  });

  it.each(translatedLanguages)(
    "keeps every placeholder in %s",
    (languageCode) => {
      const catalog = getStaticUiTranslations(languageCode);
      const broken = SOURCES.filter((source) => {
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
