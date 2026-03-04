import languages from "@/public/languages.json";

export const UI_LANGUAGE_STORAGE_KEY = "ui-language";
export const UI_LANGUAGE_CHANGED_EVENT = "ui-language-changed";
export const DEFAULT_UI_LANGUAGE = "en";

const supportedLanguageCodes = new Set(languages.map((lang) => lang.code));

export function isSupportedUiLanguage(
  languageCode: string | null | undefined,
): languageCode is string {
  return Boolean(languageCode && supportedLanguageCodes.has(languageCode));
}

export function getStoredUiLanguage(): string | null {
  if (typeof window === "undefined") return null;

  const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  return isSupportedUiLanguage(storedLanguage) ? storedLanguage : null;
}

export function setStoredUiLanguage(languageCode: string): void {
  if (typeof window === "undefined" || !isSupportedUiLanguage(languageCode)) {
    return;
  }

  window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, languageCode);
  window.dispatchEvent(
    new CustomEvent<string>(UI_LANGUAGE_CHANGED_EVENT, {
      detail: languageCode,
    }),
  );
}
