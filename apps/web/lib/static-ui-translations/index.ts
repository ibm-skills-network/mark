export type UiTranslationMap = Record<string, string>;

/**
 * Language codes that have a translations.json on disk. Used as a whitelist so
 * we never interpolate untrusted input into the dynamic import path, and so the
 * bundler can enumerate the per-language chunks ahead of time.
 *
 * Keep this in sync with the directories under lib/static-ui-translations/.
 */
const SUPPORTED_LANGUAGE_CODES = new Set<string>([
  "ar",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "kk",
  "ko",
  "nl",
  "pl",
  "pt",
  "ru",
  "sv",
  "th",
  "tr",
  "uk-UA",
  "zh-CN",
  "zh-TW",
]);

// Per-language dictionaries are large (~90-160 KB each, ~2.4 MB total). Loading
// them with a dynamic import() splits each language into its own chunk that is
// only fetched when that language is actually selected, instead of bundling all
// 23 into the main client payload.
export async function getStaticUiTranslations(
  languageCode: string,
): Promise<UiTranslationMap> {
  if (!SUPPORTED_LANGUAGE_CODES.has(languageCode)) {
    return {};
  }

  const module = await import(`./${languageCode}/translations.json`);
  return module.default as UiTranslationMap;
}
