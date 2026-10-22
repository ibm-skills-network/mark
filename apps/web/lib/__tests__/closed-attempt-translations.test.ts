/**
 * @jest-environment node
 */

import { CLOSED_ATTEMPT_SOURCE_STRINGS } from "@/app/learner/(components)/Question/ClosedAttemptNotice";
import {
  ATTEMPT_ALREADY_SUBMITTED_MESSAGE,
  ATTEMPT_CLOSED_AT_TIME_LIMIT_MESSAGE,
} from "@/lib/learner";
import languages from "@/public/languages.json";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

// A learner whose attempt was just closed on them is the last person who
// should be switched back into a language they may not read.
const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

const sources = Array.from(
  new Set([
    ...CLOSED_ATTEMPT_SOURCE_STRINGS,
    ATTEMPT_CLOSED_AT_TIME_LIMIT_MESSAGE,
    ATTEMPT_ALREADY_SUBMITTED_MESSAGE,
  ]),
);

describe("closed attempt UI translations", () => {
  it("covers every supported language", () => {
    expect(translatedLanguages.length).toBeGreaterThan(0);
  });

  it.each(translatedLanguages)("has every string in %s", (languageCode) => {
    const catalog = getStaticUiTranslations(languageCode);
    const missing = sources.filter((source) => {
      const translation = catalog[normalizeSourceText(source)];
      return typeof translation !== "string" || translation.trim().length === 0;
    });

    expect(missing).toEqual([]);
  });
});
