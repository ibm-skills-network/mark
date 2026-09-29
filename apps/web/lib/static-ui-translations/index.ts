import ar from "./ar/translations.json";
import de from "./de/translations.json";
import el from "./el/translations.json";
import en from "./en/translations.json";
import es from "./es/translations.json";
import fr from "./fr/translations.json";
import hi from "./hi/translations.json";
import hu from "./hu/translations.json";
import id from "./id/translations.json";
import it from "./it/translations.json";
import ja from "./ja/translations.json";
import kk from "./kk/translations.json";
import ko from "./ko/translations.json";
import nl from "./nl/translations.json";
import pl from "./pl/translations.json";
import pt from "./pt/translations.json";
import ru from "./ru/translations.json";
import sv from "./sv/translations.json";
import th from "./th/translations.json";
import tr from "./tr/translations.json";
import ukUA from "./uk-UA/translations.json";
import zhCN from "./zh-CN/translations.json";
import zhTW from "./zh-TW/translations.json";

export type UiTranslationMap = Record<string, string>;

// Catalog keys are matched on this form, so every lookup path must apply it.
// Shared by the DOM translator and the render-time `useUiTranslation` hook —
// two normalizers would make the same string resolve differently per path.
export function normalizeSourceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const staticUiTranslations: Record<string, UiTranslationMap> = {
  ar,
  de,
  el,
  en,
  es,
  fr,
  hi,
  hu,
  id,
  it,
  ja,
  kk,
  ko,
  nl,
  pl,
  pt,
  ru,
  sv,
  th,
  tr,
  "uk-UA": ukUA,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

// Every catalog is statically imported above, so this is a plain object lookup.
// That is what lets translation resolve during render (see `useUiTranslation`)
// instead of being applied to the DOM afterwards.
export function getStaticUiTranslations(
  languageCode: string,
): UiTranslationMap {
  return staticUiTranslations[languageCode] || {};
}
