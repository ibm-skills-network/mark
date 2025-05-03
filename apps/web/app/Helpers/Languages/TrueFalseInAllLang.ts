// Object mapping language codes to their True/False translations.
export const trueFalseTranslations: Record<
  string,
  { true: string; false: string }
> = {
  en: { true: "True", false: "False" },
  id: { true: "Benar", false: "Salah" },
  de: { true: "Wahr", false: "Falsch" },
  es: { true: "Verdadero", false: "Falso" },
  fr: { true: "Vrai", false: "Faux" },
  it: { true: "Vero", false: "Falso" },
  hu: { true: "Igaz", false: "Hamis" },
  nl: { true: "Waar", false: "Onwaar" },
  pl: { true: "Prawda", false: "Fałsz" },
  pt: { true: "Verdadeiro", false: "Falso" },
  sv: { true: "Sant", false: "Falskt" },
  tr: { true: "Doğru", false: "Yanlış" },
  el: { true: "Αληθινό", false: "Ψευδές" },
  kk: { true: "Шын", false: "Жалған" },
  ru: { true: "Верно", false: "Неверно" },
  uk: { true: "Правда", false: "Неправда" },
  ar: { true: "صحيح", false: "خطأ" },
  hi: { true: "सत्य", false: "असत्य" },
  th: { true: "จริง", false: "เท็จ" },
  ko: { true: "참", false: "거짓" },
  "zh-CN": { true: "真", false: "假" },
  "zh-TW": { true: "真", false: "假" },
  ja: { true: "真", false: "偽" },
};
