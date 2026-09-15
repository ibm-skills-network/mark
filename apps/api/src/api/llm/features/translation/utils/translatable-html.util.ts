import { sanitize } from "isomorphic-dompurify";

/**
 * Question bodies are authored as rich text, so a translation has to survive
 * the round trip through the model with its structure intact: paragraph
 * breaks, list markers, emphasis and — most importantly — link targets. The
 * allowlist below is the tag set the authoring editor emits, minus anything
 * that can execute. Images are handled separately (see
 * `prepareHtmlForTranslation`) because their payload can be a multi-megabyte
 * data URL that has no business in a prompt.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "a",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "sub",
  "sup",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
];

/**
 * `class` and `data-list` carry the list/indent semantics of the editor, and
 * `href` is the whole point of a link. Inline `style` is deliberately absent:
 * it is pure presentation, it multiplies the prompt size on content pasted
 * from office suites, and DOMPurify's URL checks do not apply inside it.
 */
const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "class",
  "data-list",
  "data-language",
  "colspan",
  "rowspan",
];

const IMAGE_TAG = /<img\b[^>]*>/gi;
const HTML_TAG = /<[a-z][^>]*>/i;

export interface PreparedTranslationHtml {
  /** Sanitized source text, safe to interpolate into a prompt. */
  preparedText: string;
  /** The original `<img>` tags, indexed by their placeholder token. */
  placeholders: string[];
  /** Whether the source carried markup that the translation should keep. */
  hasMarkup: boolean;
}

const sanitizeTranslatableHtml = (html: string): string =>
  sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Text inside a dropped tag is still content the learner needs to read.
    KEEP_CONTENT: true,
  });

/**
 * Prepare authored HTML for translation: pull images out behind placeholder
 * tokens, then drop anything that is not safe, presentational markup.
 *
 * @param text - The authored question body, HTML or plain text
 * @returns The prompt-ready text plus the image tags to restore afterwards
 */
export function prepareHtmlForTranslation(
  text: string,
): PreparedTranslationHtml {
  const placeholders: string[] = [];
  const withPlaceholders = (text || "").replaceAll(IMAGE_TAG, (match) => {
    const token = `[[IMAGE_${placeholders.length}]]`;
    placeholders.push(match);
    return token;
  });

  const preparedText = sanitizeTranslatableHtml(withPlaceholders);

  return {
    preparedText,
    placeholders,
    hasMarkup: HTML_TAG.test(preparedText),
  };
}

/**
 * Turn a model response back into storable content: re-run the allowlist over
 * it (the model is untrusted output, and it can invent tags that were never in
 * the source) and put the original image tags back.
 *
 * @param translatedText - The model's translation
 * @param placeholders - The image tags returned by `prepareHtmlForTranslation`
 * @returns Sanitized HTML with the original images restored
 */
export function restoreTranslatedHtml(
  translatedText: string,
  placeholders: string[],
): string {
  if (!translatedText) {
    return translatedText ?? "";
  }

  let restored = sanitizeTranslatableHtml(translatedText);

  for (const [index, tag] of placeholders.entries()) {
    restored = restored.replaceAll(`[[IMAGE_${index}]]`, tag);
  }

  return restored;
}

/**
 * Whether a translation lost the structure its source had. Used to flag a
 * degraded translation for follow-up without failing the learner's request.
 *
 * @param source - The prepared source text
 * @param translated - The restored translation
 * @returns True when the source had markup and the translation has none
 */
export function hasLostMarkup(source: string, translated: string): boolean {
  return HTML_TAG.test(source) && !HTML_TAG.test(translated);
}
