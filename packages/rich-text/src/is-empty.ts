/**
 * What a rich-text editor serialises when the author has typed nothing.
 *
 * Quill writes an empty document as `<p><br></p>`; TipTap writes `<p></p>`.
 * Both spellings, and any run of them, have to read as empty, because the same
 * stored value is produced by whichever editor was current when it was saved.
 *
 * This is deliberately an allowlist: a value counts as empty only when the
 * whole string is made of empty blocks, line breaks and blank space. Anything
 * the pattern does not recognise — an `<img>`, an `<iframe>`, a table, a
 * paragraph with text — falls through as non-empty. The alternative (strip the
 * tags and look at what is left) has to find tag boundaries in a string, and an
 * attribute value is allowed to contain `>`, so it can be talked into reading
 * markup as text. Failing closed costs nothing here and cannot be gamed.
 */
const EMPTY_RICH_TEXT =
  /^(?:<p(?:\s[^>]*)?>(?:\s|&nbsp;|&#160;|&#xa0;|<br\s*\/?>)*<\/p>|<br\s*\/?>|&nbsp;|&#160;|&#xa0;|\s)*$/i;

/**
 * Whether a rich-text value carries nothing an author or learner would call
 * content.
 *
 * Use this instead of comparing against a literal such as `"<p><br></p>"`: that
 * pins the check to one editor's serialisation, and silently inverts the moment
 * the editor changes.
 */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (html === null || html === undefined) {
    return true;
  }

  const value = html.trim();
  if (value.length === 0) {
    return true;
  }

  // A non-breaking space survives `.trim()`, so the pattern has to account for
  // it rather than relying on the trim above.
  return EMPTY_RICH_TEXT.test(value);
}

/** Convenience inverse, for call sites that read better in the positive. */
export function hasRichTextContent(html: string | null | undefined): boolean {
  return !isRichTextEmpty(html);
}
