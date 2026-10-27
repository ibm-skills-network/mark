const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replaceAll(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) && code <= 0x10_ff_ff
          ? String.fromCodePoint(code)
          : match;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10_ff_ff
          ? String.fromCodePoint(code)
          : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

const BLOCK_TAGS =
  /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|pre|blockquote|hr)\b[^>]*>/gi;

/** Crude HTML → readable text: drops scripts and styles, keeps line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replaceAll(/<!--[\S\s]*?-->/g, " ")
      .replaceAll(
        /<(script|style|noscript|template|svg)\b[\S\s]*?<\/\1>/gi,
        " ",
      )
      .replaceAll(BLOCK_TAGS, "\n")
      .replaceAll(/<[^>]+>/g, " "),
  )
    .replaceAll(/[\t\v\f\r ]+/g, " ")
    .replaceAll(/ *\n[\n ]*/g, "\n")
    .trim();
}

export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\w-]*(\s[^>]*)?>/i.test(text);
}
