import languages from "../../public/languages.json";

/**
 * Maps language codes to full language names
 */
export const getLanguageName = (code: string) => {
  const language = languages.find((lang) => lang.code === code);
  return language ? language.name : code.toUpperCase();
};
export const getLanguageCode = (name: string) => {
  const language = languages.find((lang) => lang.name === name);
  return language ? language.code : null;
};
export const AVAILABLE_LANGUAGES = languages.map((lang) => lang.code);
