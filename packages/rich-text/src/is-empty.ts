const EMPTY_RICH_TEXT =
  /^(?:<p(?:\s[^>]*)?>(?:\s|&nbsp;|&#160;|&#xa0;|<br\s*\/?>)*<\/p>|<br\s*\/?>|&nbsp;|&#160;|&#xa0;|\s)*$/i;

export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (html === null || html === undefined) {
    return true;
  }

  const value = html.trim();
  if (value.length === 0) {
    return true;
  }

  return EMPTY_RICH_TEXT.test(value);
}

export function hasRichTextContent(html: string | null | undefined): boolean {
  return !isRichTextEmpty(html);
}
