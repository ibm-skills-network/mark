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

export async function getStaticUiTranslations(
  languageCode: string,
): Promise<UiTranslationMap> {
  return staticUiTranslations[languageCode] || {};
}
