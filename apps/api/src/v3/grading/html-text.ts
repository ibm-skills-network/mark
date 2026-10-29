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

const MARKDOWN_TAGS = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "body",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "font",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "i",
  "img",
  "ins",
  "kbd",
  "label",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "tt",
  "u",
  "ul",
]);

const PARAGRAPH_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "blockquote",
  "figure",
  "figcaption",
  "table",
  "dl",
  "dt",
  "dd",
  "caption",
  "center",
]);

const TAG_TOKEN = /<(\/?)([a-z][\da-z-]*)((?:\s[^>]*)?)\/?>/gi;

interface ListLevel {
  ordered: boolean;
  next: number;
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(attributes);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeEntities(value);
}

/**
 * Rich-text HTML → light Markdown, so answer structure survives: ordered
 * and unordered lists (nested by two-space indent), headings, fenced code
 * blocks, inline code, bold, italic, links as "text (url)", table rows one
 * per line with cells joined by " | ", and paragraphs separated by a blank
 * line. Unknown tags (`List<String>` in a code answer) stay as text.
 */
export function htmlToMarkdown(html: string): string {
  const source = html
    .replaceAll(/<!--[\S\s]*?-->/g, " ")
    .replaceAll(
      /<(script|style|noscript|template|svg|head)\b[\S\s]*?<\/\1>/gi,
      " ",
    );
  let out = "";
  let pending = 0;
  let inPre = false;
  const lists: ListLevel[] = [];
  const links: Array<{ href?: string; text: string }> = [];
  let cellIndex = 0;

  const breakAtLeast = (lines: number) => {
    pending = Math.max(pending, lines);
  };
  const flush = () => {
    if (pending > 0 && out.length > 0) {
      out = out.replace(/[\t ]+$/, "") + "\n".repeat(pending);
    }
    pending = 0;
  };
  const emitRaw = (text: string) => {
    flush();
    out += text;
    for (const link of links) link.text += text;
  };
  const emitText = (raw: string) => {
    if (inPre) {
      emitRaw(raw);
      return;
    }
    let text = raw.replaceAll(/\s+/g, " ");
    if (text.trim().length === 0 && (pending > 0 || out.length === 0)) return;
    flush();
    if (out.length === 0 || /\s$/.test(out)) text = text.trimStart();
    out += text;
    for (const link of links) link.text += text;
  };
  const endsWithListMarker = () => /(^|\n) *(\d+\.|-) $/.test(out);

  let last = 0;
  for (const match of source.matchAll(TAG_TOKEN)) {
    const [token, slash, rawName, attributes] = match;
    const name = rawName.toLowerCase();
    if (!MARKDOWN_TAGS.has(name)) continue;
    const index = match.index ?? 0;
    if (index > last) emitText(decodeEntities(source.slice(last, index)));
    last = index + token.length;
    const closing = slash === "/";

    if (inPre && !(name === "pre" && closing)) continue;
    if (PARAGRAPH_TAGS.has(name)) {
      if (lists.length > 0) {
        if (!endsWithListMarker()) breakAtLeast(1);
      } else {
        breakAtLeast(2);
      }
      if (name === "table" || name === "tr") cellIndex = 0;
      continue;
    }
    switch (name) {
      case "br": {
        pending = Math.min(2, pending + 1);
        break;
      }
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        breakAtLeast(2);
        if (!closing) emitRaw(`${"#".repeat(Number(name[1]))} `);
        break;
      }
      case "ul":
      case "ol": {
        if (closing) {
          lists.pop();
          breakAtLeast(lists.length > 0 ? 1 : 2);
        } else {
          breakAtLeast(lists.length > 0 ? 1 : 2);
          const start = Number.parseInt(
            attribute(attributes, "start") ?? "1",
            10,
          );
          lists.push({
            ordered: name === "ol",
            next: Number.isFinite(start) ? start : 1,
          });
        }
        break;
      }
      case "li": {
        if (closing) break;
        breakAtLeast(1);
        const level = lists.at(-1);
        const indent = "  ".repeat(Math.max(0, lists.length - 1));
        if (level?.ordered) {
          emitRaw(`${indent}${level.next}. `);
          level.next += 1;
        } else {
          emitRaw(`${indent}- `);
        }
        break;
      }
      case "pre": {
        breakAtLeast(2);
        if (closing) {
          if (!out.endsWith("\n")) out += "\n";
          out += "```";
          inPre = false;
          breakAtLeast(2);
        } else {
          emitRaw("```\n");
          inPre = true;
        }
        break;
      }
      case "code":
      case "kbd":
      case "samp":
      case "tt": {
        emitRaw("`");
        break;
      }
      case "strong":
      case "b": {
        emitRaw("**");
        break;
      }
      case "em":
      case "i": {
        emitRaw("*");
        break;
      }
      case "a": {
        if (!closing) {
          links.push({ href: attribute(attributes, "href"), text: "" });
          break;
        }
        const link = links.pop();
        const href = link?.href?.trim();
        if (
          href &&
          /^(https?:|mailto:)/i.test(href) &&
          href !== link?.text.trim()
        ) {
          emitRaw(` (${href})`);
        }
        break;
      }
      case "tr": {
        breakAtLeast(1);
        cellIndex = 0;
        break;
      }
      case "td":
      case "th": {
        if (closing) break;
        if (cellIndex > 0) emitRaw(" | ");
        cellIndex += 1;
        break;
      }
      case "hr": {
        breakAtLeast(2);
        emitRaw("---");
        breakAtLeast(2);
        break;
      }
      case "img": {
        const alt = attribute(attributes, "alt");
        if (alt) emitText(` [image: ${alt}] `);
        break;
      }
      default: {
        // Inline tags with no Markdown form (span, u, sup, font…) drop out.
        break;
      }
    }
  }
  if (last < source.length) emitText(decodeEntities(source.slice(last)));
  return out.replaceAll(/[\t ]+\n/g, "\n").trim();
}
