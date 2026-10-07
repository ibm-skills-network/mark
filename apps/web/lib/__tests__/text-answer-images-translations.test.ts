/**
 * @jest-environment node
 */

import languages from "@/public/languages.json";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { TEXT_ANSWER_IMAGE_BLOCKED_MESSAGE } from "@/lib/text-answer-images";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

// The learner sees this right after their paste silently did not appear, so
// it has to be in a language they read.
const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

describe("text answer image notice translations", () => {
  it.each(translatedLanguages)("is translated in %s", (languageCode) => {
    const translation =
      getStaticUiTranslations(languageCode)[
        normalizeSourceText(TEXT_ANSWER_IMAGE_BLOCKED_MESSAGE)
      ];

    expect(typeof translation).toBe("string");
    expect(translation.trim().length).toBeGreaterThan(0);
    expect(translation).not.toBe(TEXT_ANSWER_IMAGE_BLOCKED_MESSAGE);
  });
});
