import languageData from "./languages.json";

export interface Language {
  code: string;
  name: string;
}

const languages: Language[] = languageData as Language[];

/**
 * Returns an array of all language codes.
 */
export function getAllLanguageCodes(): string[] {
  return languages.map((lang) => lang.code);
}

/**
 * Returns an array of all language names.
 */
export function getAllLanguageNames(): string[] {
  return languages.map((lang) => lang.name);
}

/**
 * Given a language code, returns the corresponding language name.
 * Returns `undefined` if not found.
 */
export function getLanguageNameFromCode(code: string): string | undefined {
  return languages.find(
    (lang) => lang.code.toLowerCase() === code.toLowerCase(),
  )?.name;
}

/**
 * Given a language name, returns the corresponding language code.
 * Returns `undefined` if not found.
 */
export function getLanguageCodeFromName(name: string): string | undefined {
  return languages.find(
    (lang) => lang.name.toLowerCase() === name.toLowerCase(),
  )?.code;
}
