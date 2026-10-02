import { hasRichTextContent, isRichTextEmpty } from "./is-empty";

describe("isRichTextEmpty", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace", "   \n\t "],
    ["Quill's empty document", "<p><br></p>"],
    ["Quill's empty document, self-closing break", "<p><br/></p>"],
    ["Quill's empty document, spaced break", "<p><br /></p>"],
    ["TipTap's empty document", "<p></p>"],
    ["a paragraph of spaces", "<p>   </p>"],
    ["a non-breaking space", "<p>&nbsp;</p>"],
    ["a numeric non-breaking space", "<p>&#160;</p>"],
    ["a literal non-breaking space", "<p> </p>"],
    ["a bare break", "<br>"],
    ["several empty paragraphs", "<p><br></p><p></p><p><br></p>"],
    [
      "an empty paragraph carrying attributes",
      '<p class="ql-align-center"></p>',
    ],
  ])("treats %s as empty", (_label, value) => {
    expect(isRichTextEmpty(value)).toBe(true);
    expect(hasRichTextContent(value)).toBe(false);
  });

  it.each([
    ["plain text", "<p>hello</p>"],
    ["text among empty paragraphs", "<p><br></p><p>hello</p><p><br></p>"],
    ["a single character", "<p>a</p>"],
    ["an image with no text", '<p><img src="data:image/png;base64,iVBOR"></p>'],
    ["a bare image", '<img src="https://example.com/a.png">'],
    [
      "a video embed",
      '<iframe class="ql-video" src="https://www.youtube.com/embed/x"></iframe>',
    ],
    ["a table", "<table><tbody><tr><td></td></tr></tbody></table>"],
    ["a horizontal rule", "<hr>"],
    ["a list with an empty item", "<ul><li></li></ul>"],
    ["a heading with no text", "<h1></h1>"],
    ["text without markup", "hello"],
  ])("treats %s as having content", (_label, value) => {
    expect(isRichTextEmpty(value)).toBe(false);
    expect(hasRichTextContent(value)).toBe(true);
  });

  /**
   * An attribute value may legally contain `>`. The pattern must not be
   * talked into reading the tail of such a value as "nothing", so anything it
   * cannot account for has to fall through as content.
   */
  it("does not read an attribute value containing '>' as empty", () => {
    expect(isRichTextEmpty('<p data-note="a><br></p>b"></p>')).toBe(false);
  });

  it("does not treat a paragraph of literal markup text as empty", () => {
    expect(isRichTextEmpty("<p>&lt;p&gt;&lt;br&gt;&lt;/p&gt;</p>")).toBe(false);
  });
});
